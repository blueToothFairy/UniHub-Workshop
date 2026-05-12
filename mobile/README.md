# UniHub Mobile Check-in

## Setup

1. Copy `.env.example` to `.env`.
2. Set `EXPO_PUBLIC_API_BASE_URL` to the backend URL your device can reach.
   - Android emulator often uses `http://10.0.2.2:3000`
   - iOS simulator can usually use `http://localhost:3000`
   - Physical devices usually need your laptop's LAN IP
3. Install dependencies with `npm install`.
4. Start the Expo app with `npm start`.

## Notes

- This app is for `checkin_staff` accounts only.
- Pending offline check-ins are stored locally in SQLite and remain on the device after sign-out.
- Camera access is optional for debugging because manual QR token entry is available as a fallback.
