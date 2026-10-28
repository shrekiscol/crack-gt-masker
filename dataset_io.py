"""Dataset folder helpers.

A dataset is a folder under the data root with this layout (same as masker):

    datasets/<dataset>/images/   source images (jpg / png / bmp / tif / webp)
    datasets/<dataset>/labels/   binary GT masks, saved as <image stem>.png

Masks are always written as single-channel 8-bit PNGs: crack = 255, background = 0.
"""

import base64
import io
import re
from os import listdir, makedirs
from os.path import join, isdir, isfile, splitext, abspath, commonpath
from typing import Union

import numpy as np
from PIL import Image

IMAGE_EXTS = ('.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff', '.webp')
_DATASET_NAME_RE = re.compile(r'^[\w\-. ]+$')


class DatasetError(Exception):
    """Raised for bad user input (unknown dataset, invalid file, ...)."""


# ---------- sorting ----------
def _atoi(text: str) -> Union[int, str]:
    return int(text) if text.isdigit() else text.lower()


def natural_keys(text: str) -> list:
    """Sort key for human order: img2 < img10."""
    return [_atoi(c) for c in re.split(r'(\d+)', text)]


# ---------- paths ----------
class DatasetStore:
    def __init__(self, root: str):
        self.root = abspath(root)
        makedirs(self.root, exist_ok=True)

    def safe_path(self, *parts: str) -> str:
        """Join paths under the root and refuse anything that escapes it."""
        path = abspath(join(self.root, *parts))
        if commonpath([path, self.root]) != self.root:
            raise DatasetError('Invalid path')
        return path

    def dataset_dir(self, dataset: str) -> str:
        path = self.safe_path(dataset)
        if not isdir(path):
            raise DatasetError(f"Dataset '{dataset}' does not exist")
        return path

    def images_dir(self, dataset: str) -> str:
        return join(self.dataset_dir(dataset), 'images')

    def labels_dir(self, dataset: str) -> str:
        return join(self.dataset_dir(dataset), 'labels')

    @staticmethod
    def label_name(image_name: str) -> str:
        return splitext(image_name)[0] + '.png'

    # ---------- listing ----------
    def list_datasets(self) -> list[dict]:
        out = []
        for name in sorted(listdir(self.root), key=natural_keys):
            if not isdir(join(self.root, name)):
                continue
            images = self.list_images(name)
            out.append({
                'name': name,
                'images': len(images),
                'labeled': sum(1 for i in images if i['labeled']),
            })
        return out

    def list_images(self, dataset: str) -> list[dict]:
        img_dir, lbl_dir = self.images_dir(dataset), self.labels_dir(dataset)
        if not isdir(img_dir):
            return []
        labels = set(listdir(lbl_dir)) if isdir(lbl_dir) else set()
        names = [f for f in listdir(img_dir)
                 if isfile(join(img_dir, f)) and f.lower().endswith(IMAGE_EXTS)]
        names.sort(key=natural_keys)
        return [{'name': n, 'labeled': self.label_name(n) in labels} for n in names]

    # ---------- writing ----------
    def create_dataset(self, dataset: str) -> str:
        dataset = dataset.strip()
        if not dataset or not _DATASET_NAME_RE.match(dataset) or dataset in ('.', '..'):
            raise DatasetError('Dataset name may only contain letters, numbers, spaces, "-", "_" and "."')
        path = self.safe_path(dataset)
        makedirs(join(path, 'images'), exist_ok=True)
        makedirs(join(path, 'labels'), exist_ok=True)
        return dataset

    def save_image(self, dataset: str, filename: str, data: bytes) -> str:
        """Store an uploaded image. Non-browser formats (tif/bmp) are kept as-is."""
        name = _clean_filename(filename)
        if not name.lower().endswith(IMAGE_EXTS):
            raise DatasetError(f"'{filename}' is not a supported image type")
        try:
            Image.open(io.BytesIO(data)).verify()
        except Exception:
            raise DatasetError(f"'{filename}' is not a valid image")
        img_dir = self.images_dir(dataset)
        makedirs(img_dir, exist_ok=True)
        with open(join(img_dir, name), 'wb') as f:
            f.write(data)
        return name

    def save_label(self, dataset: str, image_name: str, mask_b64: str) -> str:
        """Decode the browser's RGBA mask, binarize it and save it as the GT label.

        The browser paints the mask with an overlay colour; the alpha channel holds
        the actual mask, so a pixel is crack when alpha >= 128.
        """
        image_path = self.safe_path(dataset, 'images', image_name)
        if not isfile(image_path):
            raise DatasetError(f"Image '{image_name}' not found in '{dataset}'")

        mask = decode_base64_image(mask_b64)
        with Image.open(image_path) as src:
            expected = src.size
        if mask.size != expected:
            raise DatasetError(f'Mask size {mask.size} does not match image size {expected}')

        binary = binarize(mask)
        lbl_dir = self.labels_dir(dataset)
        makedirs(lbl_dir, exist_ok=True)
        out_path = join(lbl_dir, self.label_name(image_name))
        Image.fromarray(binary, mode='L').save(out_path, optimize=True)
        return out_path


# ---------- image utils ----------
def decode_base64_image(data: str) -> Image.Image:
    if ',' in data:
        data = data.split(',', 1)[1]  # strip "data:image/png;base64,"
    try:
        return Image.open(io.BytesIO(base64.b64decode(data)))
    except Exception:
        raise DatasetError('Mask data is not a valid base64 image')


def binarize(mask: Image.Image) -> np.ndarray:
    """RGBA mask (alpha = coverage) or grayscale mask -> uint8 array of 0 / 255."""
    if mask.mode in ('RGBA', 'LA') or 'transparency' in mask.info:
        values = np.asarray(mask.convert('RGBA'))[..., 3]
    else:
        values = np.asarray(mask.convert('L'))
    return np.where(values >= 128, 255, 0).astype(np.uint8)


def _clean_filename(filename: str) -> str:
    # Keep only the basename and drop characters that are unsafe on Windows/Unix.
    name = re.split(r'[\\/]', filename)[-1].strip()
    name = re.sub(r'[<>:"|?*\x00-\x1f]', '_', name)
    if not name or name in ('.', '..'):
        raise DatasetError('Invalid file name')
    return name
