# Crack GT Masker

A web tool for drawing crack ground-truth masks by hand. It has no model, so it runs on any machine with Python. It is laid out like [masker](https://github.com/Innowing-robotics-interns/masker): a Flask backend (`app.py`) with the same `datasets/<name>/images` → `datasets/<name>/labels` folders.

## Getting Started

### Option A: conda

```bash
conda env create -f environment.yml
conda activate crack-masking
python app.py
```

### Option B: plain Python (3.9+)

```bash
pip install -r requirements.txt
python app.py
```

Then open **http://127.0.0.1:8000**.

```
 * Serving Flask app 'app'
 * Debug mode: on
 * Running on http://127.0.0.1:8000
```

Options:

```bash
python app.py --root_data_path D:/crack_datasets   # use another datasets folder
python app.py --port 8001                          # another port (masker uses 8000)
python app.py --host 0.0.0.0                       # reachable from other devices (e.g. an iPad)
```

## Usage

1. On the start page, create a dataset or pick an existing one.
2. **Upload** images: use the toolbar button, press `O`, or drag & drop. They are copied into `datasets/<name>/images/`. You can also copy images into that folder yourself.
3. Paint the crack with the **Brush** (`B`). Fix mistakes with the **Eraser** (`E`). Set the thickness with the **Brush Size** slider or `[` / `]`.
4. **Save** (`Ctrl/⌘+S`) to write `datasets/<name>/labels/<image name>.png`.
5. Move to the next image with `D` (or `A` for the previous one), or click it in the file list. A green dot means the image already has a label. Opening an image loads its saved label so you can keep editing it.

### Label format

- PNG, single channel (8-bit grayscale), same size as the image.
- `255` = crack, `0` = background. The backend binarizes every mask before saving it.
- `crack_001.jpg` is saved as `labels/crack_001.png`.

### Shortcuts

| Action | Shortcut |
|---|---|
| Brush / Eraser | `B` / `E` |
| Brush size | `[` / `]` or slider |
| Undo / Redo | `Ctrl/⌘+Z` / `Ctrl/⌘+Shift+Z` or `Ctrl+Y` |
| Save | `Ctrl/⌘+S` |
| Prev / next image | `A` / `D` |
| Zoom | mouse wheel, `+` / `-` |
| Fit to screen | `F` or click the zoom % |
| Pan | `Space`+drag, right-drag or middle-drag |
| Show / hide mask | `H` |

The overlay colour and opacity only change what you see. They don't affect the saved label.

## Project Structure

```
Crack_Masking/
├── app.py               # Flask app and routes (entry point)
├── dataset_io.py        # dataset folders, image upload, mask binarize + save
├── environment.yml      # conda environment
├── requirements.txt     # pip dependencies
├── datasets/            # user data: <dataset>/images/ and <dataset>/labels/
├── public/              # static assets served at /static
│   ├── css/main.css     # styles
│   └── js/
│       ├── canvas.js       # drawing: brush, eraser, undo/redo, zoom/pan
│       ├── file_system.js  # API calls to the backend
│       ├── ui.js           # toolbar, sliders, file list, shortcuts
│       └── main.js         # app entry point
└── templates/
    ├── select_dataset.html # dataset picker
    └── index.html          # masking interface
```

### API

| Method | Route | Purpose |
|---|---|---|
| GET  | `/datasets/list` | datasets with image / label counts |
| POST | `/datasets` `{name}` | create a dataset |
| GET  | `/datasets/<ds>/images` | `[{name, labeled}]` |
| POST | `/datasets/<ds>/images` | multipart upload (`files`) |
| GET  | `/datasets/<ds>/images/<file>` | image (TIF/BMP converted to PNG) |
| GET  | `/datasets/<ds>/labels/<image file>` | saved label for that image |
| POST | `/datasets/<ds>/labels/<image file>` `{label: base64 PNG}` | save the mask |
