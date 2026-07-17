export default function TableActions({ children }) {
  return (
    <td className="table-actions-cell">
      <div className="table-actions">{children}</div>
    </td>
  );
}
