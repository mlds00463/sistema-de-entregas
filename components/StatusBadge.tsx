import { statusLabel } from '@/lib/format';

export default function StatusBadge({ status }: { status: string }) {
  return <span className={`status-chip status-${status}`}>{statusLabel(status)}</span>;
}
