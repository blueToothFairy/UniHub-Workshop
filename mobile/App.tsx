import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from "expo-camera";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNetInfo } from "@react-native-community/netinfo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { checkinApi, isApiError, workshopApi } from "./lib/api";
import {
  StaffRoleError,
  clearStoredSession,
  getOrCreateDeviceId,
  loadStoredSession,
  loginStaff,
  refreshStaffSession,
  saveStoredSession,
  type StoredSession,
  validateStaffSession,
} from "./lib/auth";
import {
  findLatestCheckinByRegistrationId,
  getCachedWorkshop,
  getRosterEntry,
  enqueuePendingCheckin,
  getPendingCheckinSummary,
  isRegistrationCancelled,
  listCheckinLog,
  listSyncLog,
  listWorkshopsCache,
  upsertCancelledRegistrations,
  upsertWorkshopRosterCache,
  upsertWorkshopsCache,
  type CachedWorkshopRecord,
  type PendingCheckinSummary,
  type StoredCheckinRecord,
  type StoredSyncLogEntry,
} from "./lib/db";
import {
  syncPendingCheckinsWithStaffCode,
  type SyncPendingCheckinsResult,
} from "./lib/sync";
import {
  buildCheckedInCard,
  buildDomainErrorCard,
  buildOfflineQueuedCard,
  buildSyncSummaryCard,
  type StaffResultCard,
} from "./lib/ui";

type ScreenState = "booting" | "signed_out" | "ready";
type ViewState = "main" | "logs";

const EMPTY_QUEUE: PendingCheckinSummary = { total: 0, retained: 0, items: [] };

const SELECTED_WORKSHOP_KEY = "unihub.mobile.selected_workshop_id";
const CANCELLED_SYNCED_AT_KEY = "unihub.mobile.cancelled_synced_at";
const ROSTER_SYNCED_AT_PREFIX = "unihub.mobile.roster_synced_at.";

function createDeviceScanId(): string {
  return `scan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createLocalCheckinId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeWorkshopId(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function formatPendingStamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function decodeBase64Url(input: string): string | null {
  if (typeof globalThis.atob !== "function") {
    return null;
  }

  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  try {
    return globalThis.atob(padded);
  } catch {
    return null;
  }
}

function extractQrClaims(token: string): {
  registration_id: string | null;
  workshop_id: string | null;
  exp: number | null;
} {
  const parts = token.split(".");
  if (parts.length < 2) {
    return { registration_id: null, workshop_id: null, exp: null };
  }

  const payloadRaw = decodeBase64Url(parts[1]);
  if (!payloadRaw) {
    return { registration_id: null, workshop_id: null, exp: null };
  }

  try {
    const payload = JSON.parse(payloadRaw) as {
      type?: string;
      registration_id?: string;
      workshop_id?: string;
      exp?: number;
    };
    if (payload.type !== "workshop_checkin") {
      return { registration_id: null, workshop_id: null, exp: null };
    }
    return {
      registration_id:
        typeof payload.registration_id === "string"
          ? payload.registration_id
          : null,
      workshop_id:
        typeof payload.workshop_id === "string" ? payload.workshop_id : null,
      exp: typeof payload.exp === "number" ? payload.exp : null,
    };
  } catch {
    return { registration_id: null, workshop_id: null, exp: null };
  }
}

function isExpiredUnixSeconds(exp: number | null): boolean {
  if (!exp) {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  return exp <= now;
}

function formatWorkshopTime(workshop: CachedWorkshopRecord | null): string {
  if (!workshop) {
    return "";
  }
  const start = workshop.starts_at
    ? new Date(workshop.starts_at).toLocaleString()
    : "?";
  const end = workshop.ends_at
    ? new Date(workshop.ends_at).toLocaleString()
    : "?";
  const room = workshop.location ? ` • ${workshop.location}` : "";
  return `${start} → ${end}${room}`;
}

export default function App(): ReactElement {
  const [screenState, setScreenState] = useState<ScreenState>("booting");
  const [viewState, setViewState] = useState<ViewState>("main");
  const [session, setSession] = useState<StoredSession | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);
  const [manualQrToken, setManualQrToken] = useState<string>("");
  const [resultCard, setResultCard] = useState<StaffResultCard | null>(null);
  const [queueSummary, setQueueSummary] =
    useState<PendingCheckinSummary>(EMPTY_QUEUE);
  const [syncResult, setSyncResult] =
    useState<SyncPendingCheckinsResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isRefreshingQueue, setIsRefreshingQueue] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isScannerOpen, setIsScannerOpen] = useState<boolean>(false);
  const [scanCooldown, setScanCooldown] = useState<boolean>(false);
  const [permission, requestPermission] = useCameraPermissions();
  const netInfo = useNetInfo();

  const [selectedWorkshopId, setSelectedWorkshopId] = useState<string | null>(
    null,
  );
  const [selectedWorkshop, setSelectedWorkshop] =
    useState<CachedWorkshopRecord | null>(null);
  const [workshops, setWorkshops] = useState<CachedWorkshopRecord[]>([]);
  const [isWorkshopPickerOpen, setIsWorkshopPickerOpen] =
    useState<boolean>(false);
  const [isLoadingWorkshops, setIsLoadingWorkshops] = useState<boolean>(false);
  const [isSyncingWorkshopData, setIsSyncingWorkshopData] =
    useState<boolean>(false);

  const [syncLogEntries, setSyncLogEntries] = useState<StoredSyncLogEntry[]>(
    [],
  );
  const [checkinLogEntries, setCheckinLogEntries] = useState<
    StoredCheckinRecord[]
  >([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState<boolean>(false);

  const online: boolean =
    netInfo.isConnected === true && netInfo.isInternetReachable !== false;

  const syncingRef = useRef<boolean>(false);
  const lastNetworkRef = useRef<{ online: boolean; type: string | null }>({
    online: false,
    type: null,
  });
  const lastAutoSyncAtRef = useRef<number>(0);

  useEffect(() => {
    syncingRef.current = isSyncing;
  }, [isSyncing]);

  useEffect(() => {
    void refreshQueueSummary();
  }, []);

  useEffect(() => {
    let active = true;
    const restoreWorkshop = async (): Promise<void> => {
      const cachedSelected = await AsyncStorage.getItem(SELECTED_WORKSHOP_KEY);
      if (!active) return;

      setSelectedWorkshopId(cachedSelected);
      const cachedList = await listWorkshopsCache();
      if (!active) return;
      setWorkshops(cachedList);

      if (cachedSelected) {
        const detail = await getCachedWorkshop(cachedSelected);
        if (!active) return;
        setSelectedWorkshop(detail);
      }
    };

    void restoreWorkshop();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadSelected = async (): Promise<void> => {
      if (!selectedWorkshopId) {
        if (active) {
          setSelectedWorkshop(null);
        }
        return;
      }
      const detail = await getCachedWorkshop(selectedWorkshopId);
      if (active) {
        setSelectedWorkshop(detail);
      }
    };
    void loadSelected();
    return () => {
      active = false;
    };
  }, [selectedWorkshopId]);

  const refreshLogs = useCallback(async (): Promise<void> => {
    setIsLoadingLogs(true);
    try {
      const [syncLog, checkinLog] = await Promise.all([
        listSyncLog(30),
        listCheckinLog(60),
      ]);
      setSyncLogEntries(syncLog);
      setCheckinLogEntries(checkinLog);
    } finally {
      setIsLoadingLogs(false);
    }
  }, []);

  useEffect(() => {
    if (viewState !== "logs") {
      return;
    }
    void refreshLogs();
  }, [refreshLogs, viewState]);

  useEffect(() => {
    let active = true;

    const restore = async (): Promise<void> => {
      try {
        const stored = await loadStoredSession();
        if (!stored) {
          if (active) {
            setScreenState("signed_out");
          }
          return;
        }

        try {
          const user = await validateStaffSession(stored.accessToken);
          const next: StoredSession = { ...stored, user };
          await saveStoredSession(next);
          if (active) {
            setSession(next);
            setSessionNotice(null);
            setScreenState("ready");
          }
          return;
        } catch (error: unknown) {
          if (error instanceof StaffRoleError) {
            await clearStoredSession();
            if (active) {
              setSession(null);
              setScreenState("signed_out");
              setSessionNotice(error.message);
            }
            return;
          }

          if (isApiError(error) && error.status === 401) {
            try {
              const refreshed = await refreshStaffSession(stored.refreshToken);
              if (active) {
                setSession(refreshed);
                setSessionNotice(null);
                setScreenState("ready");
              }
              return;
            } catch (refreshError: unknown) {
              await clearStoredSession();
              if (active) {
                setSession(null);
                setScreenState("signed_out");
                setSessionNotice(
                  refreshError instanceof Error
                    ? refreshError.message
                    : "Sign in again to continue.",
                );
              }
              return;
            }
          }

          if (active) {
            setSession(stored);
            setSessionNotice(
              "Using a cached staff session until the app can revalidate online.",
            );
            setScreenState("ready");
          }
        }
      } catch (error: unknown) {
        if (active) {
          setScreenState("signed_out");
          setSessionNotice(
            error instanceof Error
              ? error.message
              : "Unable to restore the app session.",
          );
        }
      }
    };

    void restore();

    return () => {
      active = false;
    };
  }, []);

  const refreshQueueSummary = async (): Promise<void> => {
    setIsRefreshingQueue(true);
    try {
      setQueueSummary(await getPendingCheckinSummary());
    } finally {
      setIsRefreshingQueue(false);
    }
  };

  const refreshWorkshopsFromServer = useCallback(async (): Promise<void> => {
    if (!online) {
      setResultCard({
        tone: "warning",
        title: "Offline",
        detail: "Reconnect to refresh workshops list.",
      });
      return;
    }

    setIsLoadingWorkshops(true);
    try {
      const data = await workshopApi.listWorkshops();
      const syncedAt = new Date().toISOString();
      await upsertWorkshopsCache(
        data.workshops.map((item) => ({
          workshop_id: item.id,
          title: item.title,
          starts_at: item.startsAt ?? null,
          ends_at: item.endsAt ?? null,
          location: item.location ?? null,
          status: item.status ?? null,
        })),
        syncedAt,
      );
      setWorkshops(await listWorkshopsCache());
      if (selectedWorkshopId) {
        setSelectedWorkshop(await getCachedWorkshop(selectedWorkshopId));
      }
    } catch (error: unknown) {
      if (isApiError(error)) {
        setResultCard(buildDomainErrorCard(error.code, error.message));
      } else if (error instanceof Error) {
        setResultCard({
          tone: "warning",
          title: "Workshop refresh failed",
          detail: error.message,
        });
      }
    } finally {
      setIsLoadingWorkshops(false);
    }
  }, [online, selectedWorkshopId]);

  const chooseWorkshop = useCallback(
    async (workshopId: string): Promise<void> => {
      await AsyncStorage.setItem(SELECTED_WORKSHOP_KEY, workshopId);
      setSelectedWorkshopId(workshopId);
      setIsWorkshopPickerOpen(false);
      setResultCard({
        tone: "info",
        title: "Workshop selected",
        detail: `Now checking in for workshop ${workshopId}.`,
      });
    },
    [],
  );

  const clearWorkshopSelection = useCallback(async (): Promise<void> => {
    await AsyncStorage.removeItem(SELECTED_WORKSHOP_KEY);
    setSelectedWorkshopId(null);
    setSelectedWorkshop(null);
    setIsWorkshopPickerOpen(true);
  }, []);

  const syncWorkshopData = useCallback(async (): Promise<void> => {
    if (!selectedWorkshopId) {
      setResultCard({
        tone: "warning",
        title: "Workshop required",
        detail: "Select a workshop before syncing roster/cancellations.",
      });
      return;
    }
    if (!session) {
      setResultCard({
        tone: "warning",
        title: "Sign in required",
        detail: "Sign in again to sync workshop data.",
      });
      return;
    }
    if (!online) {
      setResultCard({
        tone: "warning",
        title: "Offline",
        detail: "Reconnect to sync roster/cancellations.",
      });
      return;
    }

    setIsSyncingWorkshopData(true);
    try {
      await runWithFreshSession(async (accessToken) => {
        const rosterAfterKey = `${ROSTER_SYNCED_AT_PREFIX}${selectedWorkshopId}`;
        const rosterAfter = await AsyncStorage.getItem(rosterAfterKey);
        const roster = await checkinApi.getRoster(
          accessToken,
          selectedWorkshopId,
          rosterAfter ?? undefined,
        );
        await upsertWorkshopRosterCache(
          selectedWorkshopId,
          roster.roster.map((entry) => ({
            registration_id: entry.registration_id,
            student_user_id: entry.student_user_id,
            student_name: entry.student_name,
            student_id: entry.student_id,
            registration_status: entry.registration_status,
          })),
          roster.server_time,
        );
        await AsyncStorage.setItem(rosterAfterKey, roster.server_time);

        const cancelledAfter = await AsyncStorage.getItem(
          CANCELLED_SYNCED_AT_KEY,
        );
        const cancelled = await checkinApi.getCancelledSince(
          accessToken,
          cancelledAfter ?? undefined,
        );
        await upsertCancelledRegistrations(
          cancelled.cancelled,
          cancelled.server_time,
        );
        await AsyncStorage.setItem(
          CANCELLED_SYNCED_AT_KEY,
          cancelled.server_time,
        );

        return null;
      });

      setResultCard({
        tone: "success",
        title: "Workshop data synced",
        detail: "Roster and cancellations were refreshed.",
      });
    } catch (error: unknown) {
      if (error instanceof StaffRoleError) {
        await clearStoredSession();
        setSession(null);
        setScreenState("signed_out");
        setSessionNotice(error.message);
        return;
      }

      if (isApiError(error)) {
        setResultCard(buildDomainErrorCard(error.code, error.message));
        return;
      }

      setResultCard({
        tone: "warning",
        title: "Workshop sync deferred",
        detail: error instanceof Error ? error.message : "Try again later.",
      });
    } finally {
      setIsSyncingWorkshopData(false);
    }
  }, [online, runWithFreshSession, selectedWorkshopId, session]);

  async function runWithFreshSession<T>(
    action: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    if (!session) {
      throw new Error("Please sign in first.");
    }

    try {
      return await action(session.accessToken);
    } catch (error: unknown) {
      if (isApiError(error) && error.status === 401) {
        const refreshed = await refreshStaffSession(session.refreshToken);
        setSession(refreshed);
        setSessionNotice(null);
        return action(refreshed.accessToken);
      }

      throw error;
    }
  }

  const queueOfflineCapture = async (
    qrToken: string,
    registrationId: string,
    workshopId: string,
  ): Promise<void> => {
    const scannedAt: string = new Date().toISOString();

    const already = await findLatestCheckinByRegistrationId(registrationId);
    if (already) {
      setResultCard({
        tone: "warning",
        title: "Already recorded",
        detail: `This registration was already scanned on this device (${formatPendingStamp(already.checked_in_at)}).`,
      });
      setManualQrToken("");
      return;
    }

    if (await isRegistrationCancelled(registrationId)) {
      setResultCard({
        tone: "error",
        title: "Registration cancelled",
        detail: "This QR belongs to a cancelled registration.",
      });
      setManualQrToken("");
      return;
    }

    const rosterEntry = await getRosterEntry(workshopId, registrationId);

    await enqueuePendingCheckin({
      id: createLocalCheckinId(),
      device_id: await getOrCreateDeviceId(),
      device_scan_id: createDeviceScanId(),
      qr_token: qrToken,
      registration_id: registrationId,
      workshop_id: workshopId,
      student_name: rosterEntry?.student_name ?? null,
      student_id: rosterEntry?.student_id ?? null,
      staff_code: session?.user.email ?? null,
      checked_in_at: scannedAt,
      scanned_at_device: scannedAt,
    });

    setResultCard(buildOfflineQueuedCard(scannedAt));
    setManualQrToken("");
    await refreshQueueSummary();
  };

  const submitScan = async (providedToken?: string): Promise<void> => {
    const qrToken: string = (providedToken ?? manualQrToken).trim();
    if (!qrToken) {
      setResultCard({
        tone: "error",
        title: "QR required",
        detail: "Scan a QR code or paste the QR token before submitting.",
      });
      return;
    }

    if (!selectedWorkshopId) {
      setResultCard({
        tone: "warning",
        title: "Workshop required",
        detail:
          "Select the workshop you are checking in before scanning QR codes.",
      });
      return;
    }

    const claims = extractQrClaims(qrToken);
    if (!claims.registration_id || !claims.workshop_id) {
      setResultCard({
        tone: "error",
        title: "Invalid QR",
        detail: "This token is missing required claims.",
      });
      return;
    }

    if (isExpiredUnixSeconds(claims.exp)) {
      setResultCard({
        tone: "error",
        title: "Expired QR",
        detail: "This QR token has expired.",
      });
      return;
    }

    if (claims.workshop_id !== selectedWorkshopId) {
      setResultCard({
        tone: "error",
        title: "Wrong workshop",
        detail: "This QR code does not belong to the selected workshop.",
      });
      return;
    }

    setIsSubmitting(true);
    setSyncResult(null);

    try {
      if (!online) {
        await queueOfflineCapture(
          qrToken,
          claims.registration_id,
          selectedWorkshopId,
        );
        return;
      }

      const response = await runWithFreshSession((accessToken) =>
        checkinApi.scanCheckin(accessToken, {
          qr_token: qrToken,
          workshop_id: selectedWorkshopId,
        }),
      );

      setResultCard(buildCheckedInCard(response));
      setManualQrToken("");
      await refreshQueueSummary();
    } catch (error: unknown) {
      if (error instanceof StaffRoleError) {
        await clearStoredSession();
        setSession(null);
        setScreenState("signed_out");
        setSessionNotice(error.message);
        return;
      }

      if (isApiError(error)) {
        setResultCard(buildDomainErrorCard(error.code, error.message));
        return;
      }

      await queueOfflineCapture(
        qrToken,
        claims.registration_id,
        selectedWorkshopId,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogin = async (): Promise<void> => {
    setIsAuthenticating(true);
    setAuthError(null);
    setSessionNotice(null);

    try {
      const next = await loginStaff(email.trim(), password);
      setSession(next);
      setPassword("");
      setScreenState("ready");
      await refreshQueueSummary();
    } catch (error: unknown) {
      if (error instanceof StaffRoleError) {
        setAuthError(error.message);
      } else if (error instanceof Error) {
        setAuthError(error.message);
      } else {
        setAuthError("Unable to sign in right now.");
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleSignOut = async (): Promise<void> => {
    await clearStoredSession();
    setSession(null);
    setScreenState("signed_out");
    setSessionNotice(
      "Signed out. Pending offline check-ins stay on this device.",
    );
  };

  const handleSync = useCallback(async (): Promise<void> => {
    if (!session) {
      setResultCard({
        tone: "warning",
        title: "Sign in required",
        detail: "Sign in again before syncing pending check-ins.",
      });
      return;
    }

    setIsSyncing(true);
    try {
      const summary = await runWithFreshSession((accessToken) =>
        syncPendingCheckinsWithStaffCode(accessToken, session.user.email),
      );
      setSyncResult(summary);
      setResultCard(
        buildSyncSummaryCard(
          summary.processed,
          summary.cleared,
          summary.retained,
        ),
      );
      await refreshQueueSummary();
    } catch (error: unknown) {
      if (isApiError(error)) {
        setResultCard(buildDomainErrorCard(error.code, error.message));
      } else if (error instanceof Error) {
        setResultCard({
          tone: "warning",
          title: "Sync deferred",
          detail: error.message,
        });
      }
    } finally {
      setIsSyncing(false);
    }
  }, [refreshQueueSummary, runWithFreshSession, session]);

  useEffect(() => {
    const previous = lastNetworkRef.current;
    const currentType = typeof netInfo.type === "string" ? netInfo.type : null;
    const wifiConnectedNow = online && currentType === "wifi";
    const wifiConnectedBefore = previous.online && previous.type === "wifi";

    lastNetworkRef.current = { online, type: currentType };

    if (!wifiConnectedNow || wifiConnectedBefore) {
      return;
    }

    if (!session || syncingRef.current) {
      return;
    }

    const now = Date.now();
    if (now - lastAutoSyncAtRef.current < 10_000) {
      return;
    }
    lastAutoSyncAtRef.current = now;

    void (async () => {
      await handleSync();
      if (selectedWorkshopId) {
        await syncWorkshopData();
      }
    })();
  }, [
    handleSync,
    netInfo.type,
    online,
    selectedWorkshopId,
    session,
    syncWorkshopData,
  ]);

  const handleBarcodeScanned = async (
    result: BarcodeScanningResult,
  ): Promise<void> => {
    if (scanCooldown || isSubmitting) {
      return;
    }

    setScanCooldown(true);
    setIsScannerOpen(false);
    setManualQrToken(result.data);
    await submitScan(result.data);
    setTimeout(() => setScanCooldown(false), 1200);
  };

  if (screenState === "booting") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.centered}>
          <ActivityIndicator color="#8a5a2b" size="large" />
          <Text style={styles.title}>Preparing Mobile Check-in</Text>
          <Text style={styles.body}>
            Restoring the staff session and loading pending queue state.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (screenState === "signed_out" || !session) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <ScrollView contentContainerStyle={styles.authContainer}>
          <Text style={styles.eyebrow}>UniHub Workshop</Text>
          <Text style={styles.title}>Staff Check-in</Text>
          <Text style={styles.body}>
            Sign in with a `checkin_staff` account to scan workshop QR codes and
            manage offline sync.
          </Text>
          {sessionNotice ? (
            <Text style={styles.notice}>{sessionNotice}</Text>
          ) : null}
          {authError ? <Text style={styles.errorText}>{authError}</Text> : null}
          <TextInput
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="Staff email"
            placeholderTextColor="#8b7355"
            style={styles.input}
            value={email}
          />
          <TextInput
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor="#8b7355"
            secureTextEntry
            style={styles.input}
            value={password}
          />
          <Pressable
            disabled={isAuthenticating}
            onPress={() => void handleLogin()}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonLabel}>
              {isAuthenticating ? "Signing in..." : "Sign in"}
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (viewState === "logs") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <ScrollView contentContainerStyle={styles.workspace}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.eyebrow}>UniHub Workshop</Text>
              <Text style={styles.title}>Logs</Text>
            </View>
            <Pressable
              onPress={() => setViewState("main")}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonLabel}>Back</Text>
            </Pressable>
          </View>

          <View style={styles.section}>
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.sectionTitle}>Sync log</Text>
                <Text style={styles.helperText}>
                  Recent sync attempts on this device.
                </Text>
              </View>
              <Pressable
                disabled={isLoadingLogs}
                onPress={() => void refreshLogs()}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonLabel}>
                  {isLoadingLogs ? "Loading..." : "Refresh"}
                </Text>
              </Pressable>
            </View>

            {syncLogEntries.length === 0 ? (
              <Text style={styles.helperText}>
                No sync attempts recorded yet.
              </Text>
            ) : (
              <View style={styles.table}>
                <View style={styles.tableHeaderRow}>
                  <Text style={[styles.tableHeaderCell, styles.tableColTime]}>
                    Time
                  </Text>
                  <Text
                    style={[styles.tableHeaderCell, styles.tableColOutcome]}
                  >
                    Outcome
                  </Text>
                </View>
                {syncLogEntries.map((entry) => {
                  const time = new Date(entry.synced_at).toLocaleString();
                  const kept = Math.max(
                    0,
                    entry.records_sent -
                      entry.records_ok -
                      entry.records_conflict,
                  );
                  const outcome = entry.error
                    ? `Error: ${entry.error}`
                    : `${entry.records_ok} ok, ${entry.records_conflict} dup, ${kept} kept`;
                  return (
                    <View key={entry.id} style={styles.tableRow}>
                      <Text style={[styles.tableCell, styles.tableColTime]}>
                        {time}
                      </Text>
                      <Text style={[styles.tableCell, styles.tableColOutcome]}>
                        {outcome}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Check-in log</Text>
            <Text style={styles.helperText}>Recent scans stored locally.</Text>

            {checkinLogEntries.length === 0 ? (
              <Text style={styles.helperText}>
                No check-ins stored on this device yet.
              </Text>
            ) : (
              <View style={styles.table}>
                <View style={styles.tableHeaderRow}>
                  <Text style={[styles.tableHeaderCell, styles.tableColResult]}>
                    Status
                  </Text>
                  <Text style={[styles.tableHeaderCell, styles.tableColTime]}>
                    Time
                  </Text>
                  <Text style={[styles.tableHeaderCell, styles.tableColMeta]}>
                    Device scan
                  </Text>
                </View>
                {checkinLogEntries.map((row) => {
                  const time = new Date(row.checked_in_at).toLocaleString();
                  const statusLabel =
                    row.status === "pending_sync" ? "PENDING" : "SETTLED";
                  return (
                    <View key={row.device_scan_id} style={styles.tableRow}>
                      <Text style={[styles.tableCell, styles.tableColResult]}>
                        {statusLabel}
                      </Text>
                      <Text style={[styles.tableCell, styles.tableColTime]}>
                        {time}
                      </Text>
                      <Text style={[styles.tableCell, styles.tableColMeta]}>
                        {row.device_scan_id}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.workspace}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.eyebrow}>UniHub Workshop</Text>
            <Text style={styles.title}>Mobile Check-in</Text>
          </View>
          <View
            style={[
              styles.pill,
              online ? styles.onlinePill : styles.offlinePill,
            ]}
          >
            <Text style={styles.pillLabel}>
              {online ? "Online" : "Offline"}
            </Text>
          </View>
        </View>

        <Pressable
          onPress={() => setViewState("logs")}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonLabel}>View logs</Text>
        </Pressable>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Staff session</Text>
          <Text style={styles.body}>
            {session.user.full_name} • {session.user.email}
          </Text>
          {sessionNotice ? (
            <Text style={styles.notice}>{sessionNotice}</Text>
          ) : null}
          <Pressable
            onPress={() => void handleSignOut()}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonLabel}>Sign out</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Workshop context</Text>
          {selectedWorkshop ? (
            <>
              <Text style={styles.body}>{selectedWorkshop.title}</Text>
              <Text style={styles.helperText}>
                {formatWorkshopTime(selectedWorkshop)}
              </Text>
              <Text style={styles.helperText}>
                Workshop ID: {selectedWorkshop.workshop_id}
              </Text>
            </>
          ) : (
            <Text style={styles.helperText}>
              Select a workshop before scanning QR codes.
            </Text>
          )}

          <View style={styles.headerRow}>
            <Pressable
              disabled={!online || isLoadingWorkshops}
              onPress={() => void refreshWorkshopsFromServer()}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonLabel}>
                {isLoadingWorkshops ? "Refreshing..." : "Refresh list"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setIsWorkshopPickerOpen((value) => !value)}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonLabel}>
                {isWorkshopPickerOpen
                  ? "Hide"
                  : selectedWorkshop
                    ? "Change"
                    : "Select"}
              </Text>
            </Pressable>
          </View>

          <Pressable
            disabled={!online || !selectedWorkshopId || isSyncingWorkshopData}
            onPress={() => void syncWorkshopData()}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonLabel}>
              {isSyncingWorkshopData
                ? "Syncing..."
                : "Sync roster + cancellations"}
            </Text>
          </Pressable>

          {selectedWorkshop ? (
            <Pressable
              onPress={() => void clearWorkshopSelection()}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonLabel}>Clear selection</Text>
            </Pressable>
          ) : null}

          {isWorkshopPickerOpen ? (
            workshops.length === 0 ? (
              <Text style={styles.helperText}>
                No cached workshops yet. Tap “Refresh list” while online.
              </Text>
            ) : (
              <View style={styles.queueList}>
                {workshops.map((workshop) => {
                  const active = workshop.workshop_id === selectedWorkshopId;
                  return (
                    <Pressable
                      key={workshop.workshop_id}
                      onPress={() => void chooseWorkshop(workshop.workshop_id)}
                      style={[
                        styles.queueItem,
                        active ? styles.activeWorkshopItem : null,
                      ]}
                    >
                      <Text style={styles.queueId}>{workshop.title}</Text>
                      <Text style={styles.helperText}>
                        {formatWorkshopTime(workshop)}
                      </Text>
                      <Text style={styles.helperText}>
                        {workshop.workshop_id}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Capture</Text>
          <Text style={styles.helperText}>
            Use the camera for QR scanning or paste a token manually if the
            camera is blocked.
          </Text>

          {permission?.granted ? (
            <>
              <Pressable
                onPress={() => setIsScannerOpen((value) => !value)}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonLabel}>
                  {isScannerOpen ? "Close scanner" : "Open QR scanner"}
                </Text>
              </Pressable>
              {isScannerOpen ? (
                <View style={styles.cameraFrame}>
                  <CameraView
                    barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                    onBarcodeScanned={({ data }) =>
                      void handleBarcodeScanned({
                        data,
                        type: "qr",
                      } as BarcodeScanningResult)
                    }
                    style={styles.camera}
                  />
                </View>
              ) : null}
            </>
          ) : (
            <View style={styles.cameraBlocked}>
              <Text style={styles.helperText}>
                {permission?.canAskAgain === false
                  ? "Camera access is blocked on this device. Use manual token entry or re-enable camera permission in settings."
                  : "Camera access is not granted yet. You can still paste a QR token manually."}
              </Text>
              {permission?.canAskAgain !== false ? (
                <Pressable
                  onPress={() => void requestPermission()}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryButtonLabel}>Allow camera</Text>
                </Pressable>
              ) : null}
            </View>
          )}

          <TextInput
            multiline
            onChangeText={setManualQrToken}
            placeholder="Paste or review the QR token here"
            placeholderTextColor="#8b7355"
            style={[styles.input, styles.tokenInput]}
            value={manualQrToken}
          />
          <Pressable
            disabled={isSubmitting}
            onPress={() => void submitScan()}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonLabel}>
              {isSubmitting ? "Processing..." : "Submit check-in"}
            </Text>
          </Pressable>
        </View>

        {resultCard ? (
          <View
            style={[
              styles.resultCard,
              resultCard.tone === "success" ? styles.successCard : null,
              resultCard.tone === "warning" ? styles.warningCard : null,
              resultCard.tone === "error" ? styles.errorCard : null,
              resultCard.tone === "info" ? styles.infoCard : null,
            ]}
          >
            <Text style={styles.resultTitle}>{resultCard.title}</Text>
            <Text style={styles.body}>{resultCard.detail}</Text>
            {resultCard.stamp ? (
              <Text style={styles.resultStamp}>{resultCard.stamp}</Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.sectionTitle}>Pending queue</Text>
              <Text style={styles.helperText}>
                Pending: {queueSummary.total} • Needs retry:{" "}
                {queueSummary.retained}
              </Text>
            </View>
            <Pressable
              disabled={isRefreshingQueue}
              onPress={() => void refreshQueueSummary()}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonLabel}>
                {isRefreshingQueue ? "Refreshing..." : "Refresh"}
              </Text>
            </Pressable>
          </View>

          <Pressable
            disabled={isSyncing || !online}
            onPress={() => void handleSync()}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonLabel}>
              {isSyncing ? "Syncing..." : "Sync now"}
            </Text>
          </Pressable>
          {!online ? (
            <Text style={styles.helperText}>
              Reconnect to sync queued check-ins with the server.
            </Text>
          ) : null}

          {queueSummary.total === 0 ? (
            <Text style={styles.helperText}>
              No pending check-ins are waiting to sync.
            </Text>
          ) : (
            <Text style={styles.helperText}>
              Queued check-ins clear after a successful sync.
            </Text>
          )}

          {syncResult && syncResult.retainedItems.length > 0 ? (
            <Text style={styles.helperText}>
              Some items were kept for retry. Open Logs for details.
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f4efe6",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 16,
  },
  authContainer: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 16,
  },
  workspace: {
    padding: 20,
    gap: 18,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  table: {
    borderWidth: 1,
    borderColor: "#eadcc7",
    borderRadius: 16,
    overflow: "hidden",
  },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#fff0d8",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  tableRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#eadcc7",
  },
  tableHeaderCell: {
    color: "#8a5a2b",
    fontSize: 12,
    fontWeight: "700",
  },
  tableCell: {
    color: "#374151",
    fontSize: 12,
  },
  tableColTime: {
    flex: 2,
  },
  tableColOutcome: {
    flex: 3,
  },
  tableColResult: {
    flex: 1,
  },
  tableColMeta: {
    flex: 2,
  },
  eyebrow: {
    color: "#8a5a2b",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  title: {
    color: "#1f2937",
    fontSize: 34,
    fontWeight: "800",
  },
  body: {
    color: "#374151",
    fontSize: 16,
    lineHeight: 24,
  },
  helperText: {
    color: "#6b7280",
    fontSize: 14,
    lineHeight: 20,
  },
  notice: {
    color: "#8a5a2b",
    backgroundColor: "#fff0d8",
    borderRadius: 14,
    padding: 12,
    lineHeight: 20,
  },
  errorText: {
    color: "#9f1239",
    backgroundColor: "#ffe4e6",
    borderRadius: 14,
    padding: 12,
    lineHeight: 20,
  },
  section: {
    backgroundColor: "#fffaf2",
    borderRadius: 22,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: "#eadcc7",
  },
  sectionTitle: {
    color: "#1f2937",
    fontSize: 20,
    fontWeight: "700",
  },
  input: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#d7c5aa",
    color: "#1f2937",
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  tokenInput: {
    minHeight: 120,
    textAlignVertical: "top",
  },
  primaryButton: {
    backgroundColor: "#8a5a2b",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 16,
  },
  primaryButtonLabel: {
    color: "#fff8ef",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryButton: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#c8b08c",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
    alignSelf: "flex-start",
  },
  secondaryButtonLabel: {
    color: "#6f4c27",
    fontSize: 15,
    fontWeight: "700",
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  onlinePill: {
    backgroundColor: "#d1fae5",
  },
  offlinePill: {
    backgroundColor: "#fde68a",
  },
  pillLabel: {
    color: "#1f2937",
    fontWeight: "700",
  },
  cameraFrame: {
    overflow: "hidden",
    borderRadius: 20,
    height: 280,
    borderWidth: 1,
    borderColor: "#d7c5aa",
  },
  camera: {
    flex: 1,
  },
  cameraBlocked: {
    backgroundColor: "#fff6e8",
    borderRadius: 18,
    padding: 14,
    gap: 12,
  },
  resultCard: {
    borderRadius: 22,
    padding: 18,
    gap: 8,
    borderWidth: 1,
  },
  successCard: {
    backgroundColor: "#ecfdf5",
    borderColor: "#86efac",
  },
  warningCard: {
    backgroundColor: "#fffbeb",
    borderColor: "#fcd34d",
  },
  errorCard: {
    backgroundColor: "#fff1f2",
    borderColor: "#fda4af",
  },
  infoCard: {
    backgroundColor: "#eff6ff",
    borderColor: "#93c5fd",
  },
  resultTitle: {
    color: "#1f2937",
    fontSize: 22,
    fontWeight: "800",
  },
  resultStamp: {
    color: "#6b7280",
    fontSize: 13,
  },
  queueList: {
    gap: 10,
  },
  queueItem: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#eadcc7",
    gap: 4,
  },
  activeWorkshopItem: {
    borderColor: "#8a5a2b",
  },
  queueId: {
    color: "#1f2937",
    fontWeight: "700",
  },
  retainedTag: {
    color: "#9a3412",
    fontSize: 13,
    fontWeight: "700",
  },
  retainedList: {
    gap: 6,
  },
});
