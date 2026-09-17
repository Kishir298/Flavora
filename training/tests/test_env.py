"""Environment validation: torch + numpy must import in the FlavoraLM venv.

Regression test for the startup `UserWarning: Failed to initialize NumPy`
caused by training/requirements.txt declaring torch without numpy.
Run: .flavoralm-venv/bin/python -m unittest training.tests.test_env -v
"""

import unittest


class TestEnv(unittest.TestCase):
    def test_torch_and_numpy_import(self):
        import torch
        import numpy

        self.assertTrue(torch.__version__)
        self.assertTrue(numpy.__version__)

    def test_torch_numpy_bridge_no_warning(self):
        import warnings

        import torch
        import numpy

        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            t = torch.zeros(3)
            _ = numpy.asarray(t)
        numpy_warnings = [w for w in caught if "NumPy" in str(w.message)]
        self.assertEqual(numpy_warnings, [])


if __name__ == "__main__":
    unittest.main()
