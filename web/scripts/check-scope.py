"""Audit the candidate file set and pack a disposable, complete working-tree snapshot.

The worker's real .git is read-only. The scratch repository is a size-check fixture,
not the deployment repository or a replacement for the publisher's eventual commit.
"""
import json
import pathlib
import shutil
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
LIMIT = 8_388_608
REPORT = ROOT / 'docs/frontend/submission.json'
SCRATCH = ROOT / 'test/scratch/frontend-bundle-check'


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT).decode().strip()


def lines(value):
    return value.splitlines() if value else []


def permitted(name):
    if name == 'web/.gitignore':
        return True
    parts = pathlib.PurePosixPath(name).parts
    return parts[0] in ['web', 'dist', 'docs'] and all(not p.startswith('.') for p in parts)


changes = sorted(set(lines(git('diff', '--name-only', 'HEAD')) + lines(git('ls-files', '--others', '--exclude-standard'))))
assert all(permitted(p) for p in changes), 'Candidate contains an out-of-scope path'
assert not any('node_modules' in pathlib.PurePosixPath(p).parts or p.endswith('.tgz') for p in changes)
assert not any(line.startswith('160000') for line in lines(git('ls-files', '--stage'))), 'Submodule found'
assert not git('diff', '--name-only', 'HEAD'), 'An existing tracked file was unexpectedly changed'
exported = [p for p in (ROOT / 'dist').rglob('*') if p.is_file()]
report = {
    'scope': ['web/**', 'dist/**', 'docs/**', 'web/.gitignore'],
    'allChangesWithinScope': True,
    'existingTrackedFilesUnchanged': True,
    'dependenciesCachesArchivesAndSubmodulesExcluded': True,
    'exportFilesIncludingManifest': len(exported),
    'exportBytesIncludingManifest': sum(p.stat().st_size for p in exported),
    'maximumBundleBytes': LIMIT,
    'fullWorkingTreeSnapshotBundleBelowLimit': True,
    'bundleMeasurementMethod': 'All baseline tracked files plus candidate files packed in a fresh disposable Git repository under test/scratch. This includes the final report. It excludes ancestor history and does not replace the publisher commit.',
    'realRepositoryCommit': 'Blocked: .git/index.lock creation fails with Read-only file system. Files remain available for publisher submission.',
    'fullAncestorHistoryBundle': 'Not measurable here: a partial-clone missing object triggered a promisor fetch which also requires writing read-only .git.',
    'candidatePaths': sorted(set(changes + ['docs/frontend/submission.json'])),
}
REPORT.write_text(json.dumps(report, indent=2) + '\n')
files = sorted(set(lines(git('ls-files')) + lines(git('ls-files', '--others', '--exclude-standard'))))
if SCRATCH.exists():
    shutil.rmtree(SCRATCH)
SCRATCH.mkdir(parents=True)
for name in files:
    source = ROOT / name
    assert source.is_file() and not source.is_symlink(), name
    dest = SCRATCH / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, dest)
subprocess.run(['git', 'init', '-q', '--initial-branch=validation'], cwd=SCRATCH, check=True)
subprocess.run(['git', 'add', '--all'], cwd=SCRATCH, check=True)
subprocess.run(['git', '-c', 'user.name=Frontend validation fixture', '-c', 'user.email=validation@example.invalid', 'commit', '-qm', 'Disposable frontend snapshot for byte-budget verification'], cwd=SCRATCH, check=True)
bundle = ROOT / 'test/scratch/frontend-snapshot.bundle'
subprocess.run(['git', 'bundle', 'create', str(bundle), '--all'], cwd=SCRATCH, check=True)
size = bundle.stat().st_size
if size >= LIMIT:
    report['fullWorkingTreeSnapshotBundleBelowLimit'] = False
    REPORT.write_text(json.dumps(report, indent=2) + '\n')
    raise RuntimeError(f'Snapshot bundle is {size} bytes, limit {LIMIT}')
print(json.dumps({'status': 'passed', 'candidateFiles': len(report['candidatePaths']), 'snapshotFiles': len(files), 'snapshotBundleBytes': size, 'maximumBytes': LIMIT, 'realRepositoryCommitted': False}, indent=2))
