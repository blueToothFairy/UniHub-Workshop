import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { useNetInfo } from "@react-native-community/netinfo";
import { checkinApi, isApiError } from "./lib/api";
import {
  StaffRoleError,
  clearStoredSession,
  getOrCreateDeviceId,
  loadStoredSession,
  loginStaff,
  refreshStaffSession,
  saveStoredSession,
  type StoredSession,
  validateStaffSession
} from "./lib/auth";
import { enqueuePendingCheckin, getPendingCheckinSummary, type PendingCheckinSummary } from "./lib/db";
import { syncPendingCheckins, type SyncPendingCheckinsResult } from "./lib/sync";
import {
  buildCheckedInCard,
  buildDomainErrorCard,
  buildOfflineQueuedCard,
  buildRetainedReasonLabel,
  buildSyncSummaryCard,
  type StaffResultCard
} from "./lib/ui";

type ScreenState = "booting" | "signed_out" | "ready";

const EMPTY_QUEUE: PendingCheckinSummary = { total: 0, retained: 0, items: [] };

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

function extractQrClaims(token: string): { registration_id: string | null; workshop_id: string | null } {
  const parts = token.split(".");
  if (parts.length < 2) {
    return { registration_id: null, workshop_id: null };
  }

  const payloadRaw = decodeBase64Url(parts[1]);
  if (!payloadRaw) {
    return { registration_id: null, workshop_id: null };
  }

  try {
    const payload = JSON.parse(payloadRaw) as {
      type?: string;
      registration_id?: string;
      workshop_id?: string;
    };
    if (payload.type !== "workshop_checkin") {
      return { registration_id: null, workshop_id: null };
    }
    return {
      registration_id: typeof payload.registration_id === "string" ? payload.registration_id : null,
      workshop_id: typeof payload.workshop_id === "string" ? payload.workshop_id : null
    };
  } catch {
    return { registration_id: null, workshop_id: null };
  }
}

export default function App(): ReactElement {
  const [screenState, setScreenState] = useState<ScreenState>("booting");
  const [session, setSession] = useState<StoredSession | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);
  const [manualQrToken, setManualQrToken] = useState<string>("");
  const [workshopId, setWorkshopId] = useState<string>("");
  const [resultCard, setResultCard] = useState<StaffResultCard | null>(null);
  const [queueSummary, setQueueSummary] = useState<PendingCheckinSummary>(EMPTY_QUEUE);
  const [syncResult, setSyncResult] = useState<SyncPendingCheckinsResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isRefreshingQueue, setIsRefreshingQueue] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isScannerOpen, setIsScannerOpen] = useState<boolean>(false);
  const [scanCooldown, setScanCooldown] = useState<boolean>(false);
  const [permission, requestPermission] = useCameraPermissions();
  const netInfo = useNetInfo();

  const online: boolean = netInfo.isConnected === true && netInfo.isInternetReachable !== false;

  const syncingRef = useRef<boolean>(false);
  const lastNetworkRef = useRef<{ online: boolean; type: string | null }>({ online: false, type: null });
  const lastAutoSyncAtRef = useRef<number>(0);

  useEffect(() => {
    syncingRef.current = isSyncing;
  }, [isSyncing]);

  useEffect(() => {
    void refreshQueueSummary();
  }, []);

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
                setSessionNotice(refreshError instanceof Error ? refreshError.message : "Sign in again to continue.");
              }
              return;
            }
          }

          if (active) {
            setSession(stored);
            setSessionNotice("Using a cached staff session until the app can revalidate online.");
            setScreenState("ready");
          }
        }
      } catch (error: unknown) {
        if (active) {
          setScreenState("signed_out");
          setSessionNotice(error instanceof Error ? error.message : "Unable to restore the app session.");
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

  const runWithFreshSession = async <T,>(action: (accessToken: string) => Promise<T>): Promise<T> => {
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
  };

  const queueOfflineCapture = async (qrToken: string): Promise<void> => {
    const scannedAt: string = new Date().toISOString();
    const claims = extractQrClaims(qrToken);
    await enqueuePendingCheckin({
      id: createLocalCheckinId(),
      device_id: await getOrCreateDeviceId(),
      device_scan_id: createDeviceScanId(),
      qr_token: qrToken,
      registration_id: claims.registration_id,
      workshop_id: claims.workshop_id ?? normalizeWorkshopId(workshopId) ?? null,
      student_name: null,
      checked_in_at: scannedAt,
      scanned_at_device: scannedAt
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
        detail: "Scan a QR code or paste the QR token before submitting."
      });
      return;
    }

    setIsSubmitting(true);
    setSyncResult(null);

    try {
      if (!online) {
        await queueOfflineCapture(qrToken);
        return;
      }

      const response = await runWithFreshSession((accessToken) =>
        checkinApi.scanCheckin(accessToken, {
          qr_token: qrToken,
          workshop_id: normalizeWorkshopId(workshopId)
        })
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

      await queueOfflineCapture(qrToken);
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
    setSessionNotice("Signed out. Pending offline check-ins stay on this device.");
  };

  const handleSync = useCallback(async (): Promise<void> => {
    if (!session) {
      setResultCard({
        tone: "warning",
        title: "Sign in required",
        detail: "Sign in again before syncing pending check-ins."
      });
      return;
    }

    setIsSyncing(true);
    try {
      const summary = await runWithFreshSession((accessToken) => syncPendingCheckins(accessToken));
      setSyncResult(summary);
      setResultCard(buildSyncSummaryCard(summary.processed, summary.cleared, summary.retained));
      await refreshQueueSummary();
    } catch (error: unknown) {
      if (isApiError(error)) {
        setResultCard(buildDomainErrorCard(error.code, error.message));
      } else if (error instanceof Error) {
        setResultCard({
          tone: "warning",
          title: "Sync deferred",
          detail: error.message
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

    void handleSync();
  }, [handleSync, netInfo.type, online, session]);

  const handleBarcodeScanned = async (result: BarcodeScanningResult): Promise<void> => {
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
          <Text style={styles.body}>Restoring the staff session and loading pending queue state.</Text>
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
          <Text style={styles.body}>Sign in with a `checkin_staff` account to scan workshop QR codes and manage offline sync.</Text>
          {sessionNotice ? <Text style={styles.notice}>{sessionNotice}</Text> : null}
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
          <Pressable disabled={isAuthenticating} onPress={() => void handleLogin()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonLabel}>{isAuthenticating ? "Signing in..." : "Sign in"}</Text>
          </Pressable>
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
          <View style={[styles.pill, online ? styles.onlinePill : styles.offlinePill]}>
            <Text style={styles.pillLabel}>{online ? "Online" : "Offline"}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Staff session</Text>
          <Text style={styles.body}>{session.user.full_name} • {session.user.email}</Text>
          {sessionNotice ? <Text style={styles.notice}>{sessionNotice}</Text> : null}
          <Pressable onPress={() => void handleSignOut()} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonLabel}>Sign out</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Workshop context</Text>
          <Text style={styles.helperText}>Optional. Leave blank to let the QR payload drive workshop validation.</Text>
          <TextInput
            onChangeText={setWorkshopId}
            placeholder="Workshop ID (optional)"
            placeholderTextColor="#8b7355"
            style={styles.input}
            value={workshopId}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Capture</Text>
          <Text style={styles.helperText}>Use the camera for QR scanning or paste a token manually if the camera is blocked.</Text>

          {permission?.granted ? (
            <>
              <Pressable onPress={() => setIsScannerOpen((value) => !value)} style={styles.primaryButton}>
                <Text style={styles.primaryButtonLabel}>{isScannerOpen ? "Close scanner" : "Open QR scanner"}</Text>
              </Pressable>
              {isScannerOpen ? (
                <View style={styles.cameraFrame}>
                  <CameraView
                    barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                    onBarcodeScanned={({ data }) => void handleBarcodeScanned({ data, type: "qr" } as BarcodeScanningResult)}
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
                <Pressable onPress={() => void requestPermission()} style={styles.secondaryButton}>
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
          <Pressable disabled={isSubmitting} onPress={() => void submitScan()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonLabel}>{isSubmitting ? "Processing..." : "Submit check-in"}</Text>
          </Pressable>
        </View>

        {resultCard ? (
          <View style={[styles.resultCard, resultCard.tone === "success" ? styles.successCard : null, resultCard.tone === "warning" ? styles.warningCard : null, resultCard.tone === "error" ? styles.errorCard : null, resultCard.tone === "info" ? styles.infoCard : null]}>
            <Text style={styles.resultTitle}>{resultCard.title}</Text>
            <Text style={styles.body}>{resultCard.detail}</Text>
            {resultCard.stamp ? <Text style={styles.resultStamp}>{resultCard.stamp}</Text> : null}
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.sectionTitle}>Pending queue</Text>
              <Text style={styles.helperText}>Pending: {queueSummary.total} • Retained: {queueSummary.retained}</Text>
            </View>
            <Pressable disabled={isRefreshingQueue} onPress={() => void refreshQueueSummary()} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonLabel}>{isRefreshingQueue ? "Refreshing..." : "Refresh"}</Text>
            </Pressable>
          </View>

          <Pressable disabled={isSyncing || !online} onPress={() => void handleSync()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonLabel}>{isSyncing ? "Syncing..." : "Sync now"}</Text>
          </Pressable>
          {!online ? <Text style={styles.helperText}>Reconnect to sync queued check-ins with the server.</Text> : null}

          {queueSummary.items.length === 0 ? (
            <Text style={styles.helperText}>No queued check-ins are stored on this device right now.</Text>
          ) : (
            <View style={styles.queueList}>
              {queueSummary.items.map((item) => (
                <View key={item.device_scan_id} style={styles.queueItem}>
                  <Text style={styles.queueId}>{item.device_scan_id}</Text>
                  <Text style={styles.helperText}>{formatPendingStamp(item.scanned_at_device)}</Text>
                  {item.status === "conflict" ? <Text style={styles.retainedTag}>CONFLICT</Text> : null}
                  {item.last_error_code ? <Text style={styles.retainedTag}>{item.last_error_code}</Text> : null}
                </View>
              ))}
            </View>
          )}

          {syncResult && syncResult.retainedItems.length > 0 ? (
            <View style={styles.retainedList}>
              <Text style={styles.sectionTitle}>Retained after last sync</Text>
              {syncResult.retainedItems.map((item) => (
                <Text key={item.device_scan_id} style={styles.helperText}>
                  {item.device_scan_id}: {buildRetainedReasonLabel(item.result, item.error_code)}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f4efe6"
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 16
  },
  authContainer: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 16
  },
  workspace: {
    padding: 20,
    gap: 18
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12
  },
  eyebrow: {
    color: "#8a5a2b",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  title: {
    color: "#1f2937",
    fontSize: 34,
    fontWeight: "800"
  },
  body: {
    color: "#374151",
    fontSize: 16,
    lineHeight: 24
  },
  helperText: {
    color: "#6b7280",
    fontSize: 14,
    lineHeight: 20
  },
  notice: {
    color: "#8a5a2b",
    backgroundColor: "#fff0d8",
    borderRadius: 14,
    padding: 12,
    lineHeight: 20
  },
  errorText: {
    color: "#9f1239",
    backgroundColor: "#ffe4e6",
    borderRadius: 14,
    padding: 12,
    lineHeight: 20
  },
  section: {
    backgroundColor: "#fffaf2",
    borderRadius: 22,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: "#eadcc7"
  },
  sectionTitle: {
    color: "#1f2937",
    fontSize: 20,
    fontWeight: "700"
  },
  input: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#d7c5aa",
    color: "#1f2937",
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 14
  },
  tokenInput: {
    minHeight: 120,
    textAlignVertical: "top"
  },
  primaryButton: {
    backgroundColor: "#8a5a2b",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 16
  },
  primaryButtonLabel: {
    color: "#fff8ef",
    fontSize: 16,
    fontWeight: "700"
  },
  secondaryButton: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#c8b08c",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
    alignSelf: "flex-start"
  },
  secondaryButtonLabel: {
    color: "#6f4c27",
    fontSize: 15,
    fontWeight: "700"
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  onlinePill: {
    backgroundColor: "#d1fae5"
  },
  offlinePill: {
    backgroundColor: "#fde68a"
  },
  pillLabel: {
    color: "#1f2937",
    fontWeight: "700"
  },
  cameraFrame: {
    overflow: "hidden",
    borderRadius: 20,
    height: 280,
    borderWidth: 1,
    borderColor: "#d7c5aa"
  },
  camera: {
    flex: 1
  },
  cameraBlocked: {
    backgroundColor: "#fff6e8",
    borderRadius: 18,
    padding: 14,
    gap: 12
  },
  resultCard: {
    borderRadius: 22,
    padding: 18,
    gap: 8,
    borderWidth: 1
  },
  successCard: {
    backgroundColor: "#ecfdf5",
    borderColor: "#86efac"
  },
  warningCard: {
    backgroundColor: "#fffbeb",
    borderColor: "#fcd34d"
  },
  errorCard: {
    backgroundColor: "#fff1f2",
    borderColor: "#fda4af"
  },
  infoCard: {
    backgroundColor: "#eff6ff",
    borderColor: "#93c5fd"
  },
  resultTitle: {
    color: "#1f2937",
    fontSize: 22,
    fontWeight: "800"
  },
  resultStamp: {
    color: "#6b7280",
    fontSize: 13
  },
  queueList: {
    gap: 10
  },
  queueItem: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#eadcc7",
    gap: 4
  },
  queueId: {
    color: "#1f2937",
    fontWeight: "700"
  },
  retainedTag: {
    color: "#9a3412",
    fontSize: 13,
    fontWeight: "700"
  },
  retainedList: {
    gap: 6
  }
});
