import unittest
import numpy as np
from rhythm import infer_meter


class MeterTest(unittest.TestCase):
    def test_four_and_three(self):
        for numerator in (3, 4):
            beats = np.arange(33) * 0.5
            signature, confidence = infer_meter(beats, beats[::numerator])
            self.assertEqual(signature, [numerator, 4])
            self.assertGreaterEqual(confidence, 0.4)

    def test_abstains_for_compound_changed_or_short(self):
        beats = np.arange(49) * 0.5
        for indices in ([0, 6, 12, 18, 24], [0, 3, 7, 10, 14, 17, 21], [0, 4, 8]):
            self.assertEqual(infer_meter(beats, beats[indices]), (None, 0.0))


if __name__ == "__main__":
    unittest.main()
