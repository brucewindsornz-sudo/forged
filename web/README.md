# Forged Web

The Forged photo editor running in a browser, served from your own server or homelab. It is the same editor as the Mac app: the code in `src/renderer` is shared, and `web/` adds a browser bridge, an in-page menu bar and a small server.

Editing happens entirely in the browser. Photos only reach the server when you save them to the Library.

## What's different from the Mac app

- **Menu bar in the window.** The menus and shortcuts match the Mac app. On a Mac they use ⌘, on Windows and Linux they use Ctrl.
- **Library on the server.** File > Open from Library (⌘⇧O / Ctrl+Shift+O) browses the server's `/data` folder. Save Project and Export ask whether to save to the Library or to this computer. Projects opened from the Library save back to the same place with ⌘S.
- **This computer.** In Chrome and Edge, files open and save through the normal file dialogs, and ⌘S saves back into the file you opened. Other browsers upload and download instead.
- **Metadata removal.** Exports and conversions strip EXIF, XMP, IPTC, comments, software tags, timestamps, DPI and colour profiles in the browser, using the same rules as the Mac app. This applies whether the file goes to the Library or to your computer.
- **Fonts.** The Type tool lists the fonts on the server: some open fonts are built in, and you can mount more at `/fonts`. In Chrome and Edge, View > Use This Computer's Fonts also adds the fonts installed on your own computer (the browser asks permission once).
- **Install as an app.** Chrome and Edge can install Forged from the address bar. It then opens in its own window and can open `.forged` files.
- **Browser-reserved shortcuts.** Browsers keep ⌘N/Ctrl+N, ⌘W/Ctrl+W, ⌘T, ⌘⇧N and Ctrl+Tab for themselves. Use the File, Layer and Window menus for those, or Alt+PageUp/PageDown to switch documents.

Use HTTPS (or `localhost`). Browsers only allow the clipboard, file save-in-place and computer fonts on secure pages. Over plain `http://` on the LAN, Forged still works, but you copy and paste with the browser's own menu and files download instead of saving in place.

## Run it

### Docker

```sh
docker run -d --name forged -p 8080:8080 -v forged-data:/data ghcr.io/brucewindsornz-sudo/forged-web:latest
```

Or use `web/docker-compose.yml`. The image runs on amd64 and arm64 (Raspberry Pi 4/5).

### Kubernetes / k3s

```sh
kubectl apply -f web/k8s/forged.yaml
```

This creates the `forged` namespace, a 10 GiB volume for the Library, the Deployment, a Service and a Traefik Ingress at `forged.10.10.10.21.nip.io`. Change the host to suit your network.

For HTTPS on a Tailscale tailnet, on the node with Tailscale:

```sh
sudo tailscale serve --bg --https=8444 http://$(kubectl -n forged get svc forged -o jsonpath='{.spec.clusterIP}'):80
```

### Without Docker

```sh
node web/build.js            # writes web/public
FORGED_DATA=~/Forged node web/server.js
```

Node 18 or later, no packages needed.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Port to listen on |
| `FORGED_DATA` | `/data` | Library folder. `Projects/` and `Exports/` are created inside it. |
| `FORGED_PASSWORD` | none | When set, the browser asks for a sign-in (user `forged`) |
| `FORGED_USER` | `forged` | Sign-in user name |
| `FORGED_READ_ONLY` | `false` | Open from the Library only; no saving or deleting |
| `FORGED_FONT_DIRS` | `/fonts:/usr/share/fonts:/usr/local/share/fonts` | Font folders the Type tool lists |
| `FORGED_MAX_UPLOAD_MB` | `1024` | Largest file the Library accepts |

Any folder mounted inside `/data` appears in the Library. For example, `-v /srv/photos:/data/Photos:ro` makes an existing photo share browsable.

## Security

The server reads and writes only inside `FORGED_DATA`, and only images and `.forged`/`.kauri` files. Writes are atomic, so a project is never left half-saved. Keep it on your LAN or tailnet, or set `FORGED_PASSWORD` before exposing it more widely.
