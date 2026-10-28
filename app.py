"""Crack GT Masker: a manual ground-truth mask labelling tool (no model).

Run:  python app.py            then open http://127.0.0.1:8000
      python app.py --root_data_path D:/my_datasets --port 8001
"""

import argparse
import io
from os.path import isfile

from flask import Flask, render_template, jsonify, request, send_file, abort, redirect, url_for
from PIL import Image

from dataset_io import DatasetStore, DatasetError

parser = argparse.ArgumentParser()
parser.add_argument('--root_data_path', default='./datasets', type=str,
                    help='Folder that contains the dataset folders. Defaults to ./datasets')
parser.add_argument('--host', default='127.0.0.1', type=str,
                    help='Use 0.0.0.0 to allow other devices on the network')
parser.add_argument('--port', default=8000, type=int)
parser.add_argument('--no-debug', dest='debug', action='store_false', help='Disable Flask debug / auto-reload')
args, _ = parser.parse_known_args()

store = DatasetStore(args.root_data_path)

app = Flask(__name__, static_url_path='/static', static_folder='public')
app.config['MAX_CONTENT_LENGTH'] = 1024 * 1024 * 1024  # allow big batch uploads (1 GB)

# Browsers can't display these, so they are converted to PNG on the fly.
_CONVERT_FOR_BROWSER = ('.tif', '.tiff', '.bmp')


@app.errorhandler(DatasetError)
def handle_dataset_error(e):
    return jsonify({'status': 'error', 'message': str(e)}), 400


# ---------- pages ----------
@app.route('/')
def index():
    return render_template('select_dataset.html', datasets=store.list_datasets())


@app.route('/masking')
def masking():
    dataset = request.args.get('dataset', '')
    try:
        store.dataset_dir(dataset)
    except DatasetError:
        return redirect(url_for('index'))
    return render_template('index.html', dataset=dataset)


# ---------- dataset API ----------
@app.route('/datasets/list', methods=['GET'])
def dataset_list():
    return jsonify(store.list_datasets())


@app.route('/datasets', methods=['POST'])
def create_dataset():
    name = store.create_dataset((request.json or {}).get('name', ''))
    return jsonify({'status': 'success', 'name': name})


@app.route('/datasets/<dataset>/images', methods=['GET'])
def image_list(dataset: str):
    return jsonify(store.list_images(dataset))


@app.route('/datasets/<dataset>/images', methods=['POST'])
def upload_images(dataset: str):
    """Multipart upload of one or more images into datasets/<dataset>/images/."""
    files = request.files.getlist('files')
    if not files:
        raise DatasetError('No files received')
    saved, errors = [], []
    for f in files:
        try:
            saved.append(store.save_image(dataset, f.filename or '', f.read()))
        except DatasetError as e:
            errors.append(str(e))
    return jsonify({'status': 'success' if saved else 'error',
                    'saved': saved, 'errors': errors}), (200 if saved else 400)


@app.route('/datasets/<dataset>/images/<path:filename>', methods=['GET'])
def get_image(dataset: str, filename: str):
    path = store.safe_path(dataset, 'images', filename)
    if not isfile(path):
        abort(404)
    if path.lower().endswith(_CONVERT_FOR_BROWSER):
        with Image.open(path) as img:
            buf = io.BytesIO()
            img.convert('RGB').save(buf, format='PNG')
        buf.seek(0)
        return send_file(buf, mimetype='image/png')
    return send_file(path, max_age=0)


@app.route('/datasets/<dataset>/labels/<path:image_name>', methods=['GET'])
def get_label(dataset: str, image_name: str):
    """Return the saved GT mask for an image (looked up by the image's file name)."""
    path = store.safe_path(dataset, 'labels', store.label_name(image_name))
    if not isfile(path):
        abort(404)
    return send_file(path, mimetype='image/png', max_age=0)


@app.route('/datasets/<dataset>/labels/<path:image_name>', methods=['POST'])
def save_label(dataset: str, image_name: str):
    """Body: {"label": "<base64 PNG>"}. Saved as labels/<image stem>.png (0 / 255)."""
    data = (request.json or {}).get('label')
    if not data:
        raise DatasetError('No mask data provided')
    out_path = store.save_label(dataset, image_name, data)
    return jsonify({'status': 'success', 'message': f'Saved {out_path}', 'path': out_path})


if __name__ == '__main__':
    print(f'Datasets folder: {store.root}')
    app.run(host=args.host, port=args.port, debug=args.debug)
