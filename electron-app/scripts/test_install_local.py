import importlib.util
from pathlib import Path
import shutil
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('install_local', Path(__file__).with_name('install-local.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class ReplacementRecovery(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix='tempo-installer-test-')
        self.root = Path(self.scratch.name)
        self.source = self.root/'candidate.app'
        self.installed = self.root/'Applications/Tempo.app'
        self.backups = self.root/'private-backups'
        for path, version in [(self.source, 'candidate'), (self.installed, 'previous')]:
            path.mkdir(parents=True)
            (path/'version').write_text(version)

    def tearDown(self):
        self.scratch.cleanup()

    def verify(self, path):
        self.assertTrue((path/'version').is_file())

    def test_replacement_retains_a_verified_private_copy(self):
        backup = installer.replace_app(self.source, self.installed, self.backups,
            verify=self.verify, copy=shutil.copytree)
        self.assertEqual((self.installed/'version').read_text(), 'candidate')
        self.assertEqual((backup/'version').read_text(), 'previous')
        self.assertEqual((self.source/'version').read_text(), 'candidate')
        self.assertEqual(list(self.installed.parent.iterdir()), [self.installed])

    def test_backup_failure_leaves_the_installed_app_untouched(self):
        def failing_copy(source, target):
            if target.name == 'Tempo.app':
                raise OSError('Synthetic backup failure')
            shutil.copytree(source, target)
        with self.assertRaises(OSError):
            installer.replace_app(self.source, self.installed, self.backups,
                verify=self.verify, copy=failing_copy)
        self.assertEqual((self.installed/'version').read_text(), 'previous')

    def test_failed_installed_verification_restores_the_previous_bundle(self):
        def failing_verify(path):
            self.verify(path)
            if path == self.installed and (path/'version').read_text() == 'candidate':
                raise ValueError('Synthetic installed signature failure')
        with self.assertRaises(ValueError):
            installer.replace_app(self.source, self.installed, self.backups,
                verify=failing_verify, copy=shutil.copytree)
        self.assertEqual((self.installed/'version').read_text(), 'previous')
        self.assertEqual(list(self.installed.parent.iterdir()), [self.installed])


if __name__ == '__main__':
    unittest.main()
