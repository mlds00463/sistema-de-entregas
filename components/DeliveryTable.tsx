import { Fragment } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { formatDate, formatDateTime, formatDuration } from '@/lib/format';
import type { Delivery, DeliveryReport } from '@/lib/types';
import StatusBadge from './StatusBadge';

function getLocalDateKey(value: string | null | undefined) {
  if (!value) return 'sem-data';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'sem-data';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

type DeliveryTableProps = {
  deliveries: Array<Delivery | DeliveryReport>;
  canDelete?: boolean;
  canEditAddress?: boolean;
  deletingDeliveryId?: string | null;
  editingDeliveryId?: string | null;
  onDeleteDelivery?: (delivery: Delivery | DeliveryReport) => void;
  onEditDelivery?: (delivery: Delivery | DeliveryReport) => void;
};

export default function DeliveryTable({
  deliveries,
  canDelete = false,
  canEditAddress = false,
  deletingDeliveryId = null,
  editingDeliveryId = null,
  onDeleteDelivery,
  onEditDelivery,
}: DeliveryTableProps) {
  const hasActions = canDelete || canEditAddress;
  const colSpan = hasActions ? 7 : 6;
  const groupedDeliveries = [...deliveries]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .reduce<Array<{ dateKey: string; label: string; items: Array<Delivery | DeliveryReport> }>>((groups, delivery) => {
      const dateKey = getLocalDateKey(delivery.created_at);
      const lastGroup = groups[groups.length - 1];

      if (lastGroup?.dateKey === dateKey) {
        lastGroup.items.push(delivery);
        return groups;
      }

      groups.push({
        dateKey,
        label: formatDate(delivery.created_at),
        items: [delivery],
      });

      return groups;
    }, []);

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Loja</th>
            <th>Motoqueiro</th>
            <th>Status</th>
            <th>Destino</th>
            <th>Tempo</th>
            {hasActions && <th>Ação</th>}
          </tr>
        </thead>
        <tbody>
          {groupedDeliveries.map((group) => (
            <Fragment key={group.dateKey}>
              <tr className="date-group-row">
                <td colSpan={colSpan}>
                  <strong>{group.label}</strong>
                  <span>{group.items.length} pedido(s)</span>
                </td>
              </tr>
              {group.items.map((delivery) => {
                const shopName = 'shop_name' in delivery ? delivery.shop_name : delivery.shops?.name;
                const driverName = 'motorcyclist_name' in delivery
                  ? delivery.motorcyclist_name
                  : delivery.motorcyclists?.name;
                const destination = 'destination_address' in delivery ? delivery.destination_address : '-';

                return (
                  <tr key={delivery.id}>
                    <td>{formatDateTime(delivery.created_at)}</td>
                    <td>{shopName ?? '-'}</td>
                    <td>{driverName ?? '-'}</td>
                    <td><StatusBadge status={delivery.status} /></td>
                    <td>{destination}</td>
                    <td>{formatDuration(delivery.total_duration_seconds)}</td>
                    {hasActions && (
                      <td className="action-cell">
                        {canEditAddress && 'destination_address' in delivery && !['delivered', 'cancelled'].includes(delivery.status) && (
                          <button
                            className="button secondary compact-button"
                            type="button"
                            disabled={editingDeliveryId === delivery.id}
                            onClick={() => onEditDelivery?.(delivery)}
                          >
                            <Pencil size={16} />
                            {editingDeliveryId === delivery.id ? 'Editando' : 'Editar'}
                          </button>
                        )}
                        {canDelete && (
                          <button
                            className="button danger compact-button"
                            type="button"
                            disabled={deletingDeliveryId === delivery.id}
                            onClick={() => onDeleteDelivery?.(delivery)}
                          >
                            <Trash2 size={16} />
                            {deletingDeliveryId === delivery.id ? 'Excluindo...' : 'Excluir'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </Fragment>
          ))}
          {deliveries.length === 0 && (
            <tr>
              <td colSpan={colSpan}>Nenhuma entrega encontrada.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
