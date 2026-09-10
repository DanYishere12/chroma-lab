"""Algorithm and image preprocessing regression tests. No network or fixtures needed."""
import unittest
import numpy as np
from PIL import Image
from palette import extract_palette, kmeans, rgb_to_oklab, oklab_to_rgb


class PaletteTests(unittest.TestCase):
    def test_color_round_trip(self):
        colors = np.array([[r, g, b] for r in range(0, 256, 51)
                           for g in range(0, 256, 51) for b in range(0, 256, 51)], dtype=np.uint8)
        np.testing.assert_array_equal(oklab_to_rgb(rgb_to_oklab(colors)), colors)

    def test_uniform_image(self):
        poster, data = extract_palette(Image.new('RGB', (8, 4), '#1166CC'), 12)
        self.assertEqual(data['colors'], [{'hex': '#1166CC', 'pixels': 32, 'share': 1.0}])
        self.assertEqual(poster.getpixel((0, 0)), (17, 102, 204))

    def test_actual_coverage_and_determinism(self):
        image = Image.new('RGB', (4, 1), 'red')
        image.putpixel((3, 0), (0, 0, 255))
        poster, data = extract_palette(image, 2)
        again, repeat = extract_palette(image, 2)
        self.assertEqual(data, repeat)
        self.assertEqual(poster.tobytes(), again.tobytes())
        self.assertEqual(data['colors'], [
            {'hex': '#FF0000', 'pixels': 3, 'share': .75},
            {'hex': '#0000FF', 'pixels': 1, 'share': .25},
        ])

    def test_transparency_is_composited_on_white(self):
        poster, data = extract_palette(Image.new('RGBA', (2, 2), (255, 0, 0, 0)))
        self.assertEqual(data['colors'][0]['hex'], '#FFFFFF')
        self.assertEqual(poster.getpixel((0, 0)), (255, 255, 255))

    def test_tall_images_and_sample_budget(self):
        poster, data = extract_palette(Image.new('RGB', (100, 2400), 'blue'))
        self.assertEqual(poster.size, (50, 1200))
        self.assertEqual(data['sample_size'], 8000)
        self.assertEqual(sum(c['pixels'] for c in data['colors']), 60000)

    def test_exif_orientation(self):
        image = Image.new('RGB', (3, 2), 'red')
        image.getexif()[274] = 6
        poster, _ = extract_palette(image)
        self.assertEqual(poster.size, (2, 3))

    def test_invalid_parameters(self):
        for k in [0, 1, 13, 2.5, True]:
            with self.subTest(k=k), self.assertRaises(ValueError):
                kmeans(np.zeros((2, 3)), k)
        with self.assertRaises(ValueError):
            kmeans(np.array([[0, np.nan, 0]]), 2)
        with self.assertRaises(ValueError):
            kmeans(np.zeros((2, 3)), 2, max_iterations=0)


if __name__ == '__main__':
    unittest.main()
