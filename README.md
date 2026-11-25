# Forged

Forged is an original photo editor for macOS, built with Electron by New Zee Build. Its layout, tools and keyboard shortcuts follow the conventions of mainstream consumer photo editors, but all of its code, design and branding are original.

**Web version:** Forged also runs in a browser from your own server or homelab (Docker, Kubernetes/k3s or plain Node). See [web/README.md](web/README.md).

## Install with Homebrew (recommended)

```sh
brew install --cask brucewindsornz-sudo/forged/forged
```

This uses the [homebrew-forged](https://github.com/brucewindsornz-sudo/homebrew-forged) tap. That tap copies the cask from `Casks/forged.rb` in this repo every few hours.

To update later:

```sh
brew update && brew upgrade --cask forged
```

To uninstall, run `brew uninstall --cask forged`. Add `--zap` to remove its settings as well. The cask clears the macOS download flag and re-signs the app on your Mac, so you won't get the "Move to Trash" warning.

## Releasing a new version

1. Change `"version"` in `package.json`, for example to `1.0.1`, and commit.
2. Tag and push: `git tag v1.0.1 && git push origin main v1.0.1`.
3. The Release workflow builds both Mac apps, publishes the GitHub release and updates `Casks/forged.rb`. The tap picks up the change within about three hours. You can run its Sync cask workflow to copy it straight away. After that, `brew upgrade --cask forged` installs the new version.

## Install the ready-made app manually

1. Unzip the right build for your Mac:
   - Apple Silicon (M1–M4): `Forged-1.0.0-arm64-mac.zip`
   - Intel: `Forged-1.0.0-x64-mac.zip`
2. Drag `Forged.app` into Applications.
3. The app isn't signed with an Apple developer certificate, so the first time you open it macOS may say it "can't be opened" or "is damaged" and offer to move it to the Trash. Choose Done or Cancel, not Move to Trash. Then use either fix:
   - **Terminal (always works):** run `xattr -cr "/Applications/Forged.app" && codesign --force --deep --sign - "/Applications/Forged.app"`, then open the app normally.
   - **System Settings:** go to Privacy & Security, scroll down, and choose Open Anyway next to the Forged message. Then confirm with your password.

## Run or build from source

You need Node.js 18 or later.

```sh
npm install
npm start          # run in development
npm run dist       # build .dmg and .zip for Apple Silicon and Intel into dist/
npm run dist:arm64 # Apple Silicon only
```

When you build on your own Mac, the .dmg installer is created as well.

## Features

- Tabbed documents, Photo Bin, Layers, Adjust, Effects and History panels, plus a Navigator with a histogram and an info readout.
- Layers: pixel, text, shape, fill and adjustment layers; smart (placed) layers; masks; clipping masks; lock transparency; blend modes; opacity; and layer styles (drop shadow, stroke, glow).
- Tools: Move, Zoom, Hand, Marquee, Lasso (freehand and polygonal), Magic Wand, Quick Selection, Selection Brush, Brush, Pencil, Eraser, Background Eraser, Magic Eraser, Paint Bucket, Gradient, Clone Stamp, Healing Brush, Spot Healing Brush, Red Eye, Blur, Sharpen, Smudge, Dodge, Burn, Sponge, Type, Shapes, Crop, Straighten and Eyedropper.
- Erasers (E, Shift+E cycles): the Eraser has Brush, Pencil and Block types. The Background Eraser removes colours like the one under its centre cross, with tolerance, limits, sampling and a protect-foreground option. The Magic Eraser removes a similar-coloured area in one click.
- Export (Alt+Shift+Cmd+S) saves JPEG, PNG or WebP. File > Convert Forged Projects… turns one or more .forged files into PNG or JPEG in a folder you choose, without opening them, and never overwrites existing files. Every export and conversion has its metadata removed: EXIF (camera and location), XMP, IPTC, comments, software tags, timestamps, DPI and colour profiles.
- PDF files: File > Open (or drag and drop) opens a PDF. Choose the pages (for example `all` or `1-3, 5`), the resolution (72–600 ppi, 150 by default) and whether each page becomes its own document or one document with a layer per page. Password-protected PDFs ask for the password. Each page opens at its real size, so rulers and Image Size show true centimetres. File > Place Photo or PDF… (or dropping a PDF onto an open picture) adds PDF pages as scalable placed layers. File > Export as PDF… saves this document, every open document in tab order, or each layer as a page, with JPEG or lossless images and the original page sizes. Exported PDFs contain no metadata. PDF reading uses Mozilla's pdf.js (`src/renderer/vendor/pdfjs`, Apache-2.0), and Forged never runs scripts inside PDFs.
- Selection Brush (A, Shift+A cycles with Quick Selection and Magic Wand): paint a selection with the size, hardness and feather you choose. Feather softens the edge of each stroke by the number of pixels you set. Alt paints the opposite way. Mask view shows the unselected area as a red overlay, and painting in that view adds to the red.
- Paint Bucket and Magic Eraser: hover to preview the exact area (green tint and pixel count) before you click. Tolerance compares colours channel by channel, so it behaves consistently. Smooth edges blends into anti-aliased lines with no pale fringe, and Expand grows or shrinks the area by up to 10 px.
- Healing (J, Shift+J cycles): Alt-click (Option-click) places a source marker, and Alt-drag moves it. The Healing Brush paints texture from the marker and blends it with the surrounding tone, or copies exactly in Replace mode. The Spot Healing Brush can fill automatically (Content-aware or Proximity match) or use Source point. Alt-clicking switches it to Source point. Aligned keeps the source moving with your brush. The Clone Stamp uses the same marker.
- Fonts: the Type tool lists every font installed on your Mac. That includes fonts in your user and system font folders, fonts downloaded through Font Book, and active Adobe Fonts. The picker is searchable, shows each font name in its own typeface and lists recent fonts at the top. The Style menu offers every weight and style the family has, such as Light, Medium, Condensed or Black Italic. Fonts you install while the app is open appear after you click Refresh in the picker.
- Move tool: "Constrain proportions" is on by default. Untick it to resize text, photos and shapes freely from the corner handles. The side handles stretch text in one direction, and the W and H boxes can then be set separately. Holding Shift while dragging temporarily switches the setting.
- Enhance: Auto Smart Fix, Auto Levels, Auto Contrast, Auto Color, Auto Sharpen and Auto Red Eye, plus Levels, Curves, Hue/Saturation, Color Balance, Brightness/Contrast, Shadows/Highlights and more, all with live preview.
- Filters: blur, sharpen, Unsharp Mask, noise, artistic and stylise effects.
- Select: Select All, Deselect, Reselect, Inverse, Feather, Grow, Select Subject (approximate) and content-aware fill (patch-based).
- Photo Collage: 18 layouts, page sizes, margins, gaps, corners, borders, shadows and shuffle. You can drag to pan a photo inside its frame, use the scroll wheel to zoom, and drop a photo from the Photo Bin onto a frame to replace it.
- Rulers and guides in pixels, millimetres, centimetres, inches or points. The default is centimetres.
  - Right-click a ruler, or use View > Ruler Units, to change units.
  - Drag from a ruler to add a guide. Hold Shift to snap it to ruler ticks, or Alt to swap its direction.
  - Drag a guide back onto a ruler to delete it, or double-click it to type an exact position.
  - Drag the ruler corner to move the zero point, and double-click the corner to reset it.
  - View > New Guide, New Guide Layout (columns, rows, gutters and margins), Lock Guides (⌥⌘;) and Clear Guides.
  - Marquees, crop and shapes snap to guides, document edges and the grid.
- Document resolution (ppi) is read from JPEG and PNG files. New Document, Image Size and Canvas Size all accept mm, cm and inches, and include metric paper and photo presets. Guide colour and style, and grid spacing in metric units, are set in Preferences.
- Keyboard shortcuts follow the familiar consumer photo-editor scheme. In the app, open Help > Keyboard Shortcuts to see the full list.
- Saving: `.forged` project files keep all layers, and older `.kauri` projects still open. You can export to PNG, JPEG or WebP.

## Known limits

- There are no AI or cloud features such as automatic guided edits or an organiser or catalogue.
- Select Subject uses colour clustering, and content-aware fill uses patch synthesis, so complex scenes may need touching up.
- PDF pages are edited as pictures. Text in a PDF can be painted over, cloned or covered with new Type layers, but it is not editable as text, and an exported PDF's text can't be selected or searched.
- There is no Magnetic Lasso, Recompose tool or Smart Brush, and no printing yet.
