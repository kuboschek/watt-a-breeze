# Watt a Breeze

A cycling and cooling pun, and a dependency-free local controller for the Wahoo KICKR HEADWIND. Watt a Breeze runs on your computer and communicates directly with the fan using Web Bluetooth. No account, build step, analytics, cloud, or native Bluetooth helper.

**Manual fan control works:** connect your HEADWIND, set airflow with the slider or presets, and turn the fan off. Browser adaptive cooling is implemented separately and still needs physical sensor validation.

## Run

Requires Node.js 22+ and a browser with Web Bluetooth (Chrome or Edge on macOS/Windows, or a supported Android browser). Safari and Firefox cannot connect directly. Linux support depends on browser/platform configuration.

```sh
npm start
```

Open **http://127.0.0.1:5173** in Chrome. Bluetooth must be enabled; grant the browser Bluetooth access in macOS settings if requested. The server binds only to the local loopback interface. `PORT=5174 npm start` changes its port. Press Ctrl+C to stop it.

1. Plug in your HEADWIND and click **Connect**. Select it in the browser chooser. Use **Show renamed Bluetooth devices** under Advanced if the fan was renamed. A device without the expected service is rejected.
2. Drag the slider to adjust airflow in 1% increments, or use a preset. Slider changes are debounced by 150 ms, with the final selection sent on release; changes during a Bluetooth write are coalesced to the latest value. **Reapply airflow** under Advanced also sends the selected value. **Turn off** sends the off-mode command. Connecting alone does not change the fan's mode or speed.
3. Optionally connect a standard BLE heart-rate sensor and/or cycling-power sensor. Enable the sensor in the cooling profile, wait for a reading, then start **browser adaptive control**.
4. **Try demo mode** exercises the interface and adaptive logic with simulated sensors without selecting any Bluetooth device. Real connections and demo are mutually exclusive. The separate profile preview readings never control hardware.

The default view contains only basic fan controls. Open **Advanced** for adaptive cooling, sensor thresholds, demo mode, renamed-device discovery, firmware details, and connection logs. Collapsing Advanced keeps active adaptive control running; its badge remains visible beside the basic controls, and **Turn off** stops it.

## Install as a web app

Open the HTTPS hosted site (or the local URL above) in Chrome or Edge, then use the address-bar install icon or the browser menu's **Install app** option. On supported Android browsers, use **Install app** or **Add to Home screen**. Launching the installed app opens Watt a Breeze in its own window with the smiling fan icon. Installation requires a [compatible browser and a secure origin](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable); localhost and `127.0.0.1` work for local use.

After the first successful online load finishes caching, the app can reopen offline. Fan control still uses local Bluetooth and requires a browser with Web Bluetooth; installing on Safari or iOS does not add Bluetooth support. Reconnect your fan when you reopen the app. Keep the app visible and your computer awake during browser adaptive control.

The service worker tries the network first and falls back to cached app files when offline. Updates are picked up when you open or reload while online. Bluetooth permissions and cooling profiles stay local to the site's origin.

## GitHub Pages

The app also works as an HTTPS static site. GitHub only hosts the files; Bluetooth communication and sensor readings stay in your browser. The local Node server is not deployed. Bluetooth permissions and saved profiles belong to each origin, so the hosted site needs its own device permission and profile setup.

`.github/workflows/pages.yml` checks JavaScript, runs the tests, and builds on pushes and pull requests to `main`. Successful pushes to `main` deploy `dist/` to GitHub Pages; pull requests only validate. You can also run the workflow manually from Actions. The workflow uses GitHub's built-in token and does not need a personal access token secret.

For a new repository, enable **Settings → Pages → Build and deployment → Source: GitHub Actions** before running the deployment. The repository must support Pages under your GitHub plan. The deployed URL appears on the successful workflow's `github-pages` environment.

```sh
npm run build
```

This copies the browser assets, web app manifest, service worker, and app icons into `dist/`, plus `.nojekyll`. Relative asset URLs and the service worker scope support both a repository subpath and a custom domain. No dependency installation is required. See [GitHub's Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Multi-sensor settings: what works

| Feature | PoC support |
| --- | --- |
| Manual speed 1–100%, fan off | Working with the HEADWIND via Bluetooth: slider, presets, and turn off |
| Browser adaptive cooling from heart rate and cycling power | Implemented with live BLE measurements, local thresholds, and higher-demand selection each second |
| Threshold planner for HR, power, cycling speed, run pace, CORE temperature | Local storage, interactive preview, JSON export |
| Native fan sensor discovery, pairing, enable/disable, read/write thresholds | **Not implemented. Use the Wahoo app.** No verified protocol was found for these newer operations |
| ANT+, FTMS-only trainers, live cycling speed/run pace/CORE | Not supported by this PoC |

Wahoo introduced native adaptive cooling in firmware **2.0.43** (Wahoo app **6.80.0** or newer). It supports the five sensor types above and selects the highest requested airflow each second. In the Wahoo app: Devices → HEADWIND → Sensor → add/pair sensors → check active sensors → Manage thresholds. Newer firmware may be available; update through the Wahoo app.

The browser alternative keeps the fan in manual mode and computes `clamp((reading − start) / (full − start), 0, 1) × 100`, rounded to an integer. This is a **linear PoC curve**, not a verified reproduction of Wahoo's internal curve. Sample thresholds are illustrative. Pace uses decimal minutes/km, with a slower start pace greater than the full-airflow pace (e.g. 8 to 4). HR/power edits affect the browser controller; all five rows affect the isolated preview. Settings are never copied to or read from the fan. Exported JSON documents this scope and cannot be imported into the Wahoo app.

The live controller ignores disabled, disconnected, and older-than-10-second measurements. If no enabled live sensor has fresh data, it pauses and leaves the last fan command in effect. A fresh zero reading is valid and can turn the fan off. No automatic restart occurs after a pause. Hiding the page also pauses control and retains the fan setting. The app requests a screen wake lock where available; keep the computer awake and the page visible.

**Disconnecting, closing the tab, or losing Bluetooth may leave the fan running.** The off button and “Stop adaptive control & turn fan off” explicitly write off. Physical buttons remain the fallback. The gauge reports the last successfully written command; it is not measured airflow or an application-level acknowledgement. Other apps or the fan buttons may change its actual state. Raw notifications appear in the log without assuming the legacy state format still describes new firmware.

## Validation

```sh
npm run check
npm test
```

Node tests cover packet encoding, serialized writes, cancellation on disconnect, write failures, BLE sensor decoding, validation, stale measurements, and combining sensor demands. They use simulated Bluetooth devices. Manual fan control works with the HEADWIND; browser adaptive control and live sensor pairing still need hardware validation.

## Protocol and research sources

- [Tailwind source](https://github.com/tuna-f1sh/tailwind/blob/main/src/main.rs): community GATT service/characteristic identifiers, manual mode and speed commands. This implementation independently encodes those protocol facts.
- [Wahoo sensor pairing and adaptive cooling](https://support.wahoofitness.com/hc/en-us/articles/360000780200-Pair-a-Sensor-or-Trainer-to-HEADWIND).
- [Wahoo firmware release notes](https://support.wahoofitness.com/hc/en-us/articles/360000760259-KICKR-HEADWIND-Firmware-Release-Notes).
- [Web Bluetooth in Chrome](https://developer.chrome.com/docs/capabilities/bluetooth).
- [Bluetooth Heart Rate Service](https://www.bluetooth.com/specifications/specs/heart-rate-service-1-0/), [Cycling Power Service](https://www.bluetooth.com/specifications/specs/cycling-power-service-1-1/).

The fan service is `a026ee0c-0a7d-4ab3-97fa-f1500f9feb8b`; its command characteristic is `a026e038-0a7d-4ab3-97fa-f1500f9feb8b`. Manual control writes `[04,04,00,00]`, then `[02,speed,00,00]`; off writes `[04,01,00,00]` (hex). GATT batches are serialized and invalidated when the connection changes. No guessed native configuration commands are exposed.

Unofficial experiment, unaffiliated with Wahoo Fitness.
