import { useEffect, useState } from 'react';
import { pendingBackup, pendingWriteCount, retryPendingWrites, STORAGE_EVENT } from '../storage';

export default function StorageNotice() {
  const [, setRevision] = useState(0);
  useEffect(() => {
    const update = () => setRevision(value => value + 1);
    window.addEventListener(STORAGE_EVENT, update);
    return () => window.removeEventListener(STORAGE_EVENT, update);
  }, []);
  if (!pendingWriteCount()) return null;
  return <aside className="storage-notice" role="alert"><div><strong>Some changes could not be saved in this browser.</strong><p>Keep this tab open. Free browser storage and retry, or download the unsaved data before closing.</p></div><button className="button outline small" onClick={retryPendingWrites}>Retry saving</button><a className="text-action" href={`data:application/json;charset=utf-8,${encodeURIComponent(pendingBackup())}`} download="roundseo-unsaved-data.json">Download unsaved data</a></aside>;
}
