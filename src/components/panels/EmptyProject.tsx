/**
 * Пустой проект: первый экран без изделий (этап 35).
 *
 * Раньше пользователь видел пустую сцену и должен был сам догадаться, с чего
 * начать. Теперь виден понятный следующий шаг — и он ведёт в тот же мастер
 * создания, что и кнопка на панели слева: другого пути создания нет.
 */
interface Props {
  onCreateFurniture: () => void;
  onOpenCabinetDesigner: () => void;
}

export function EmptyProject({ onCreateFurniture, onOpenCabinetDesigner }: Props) {
  return (
    <div
      data-testid="empty-project"
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%', gap: 10, textAlign: 'center',
        padding: 24,
      }}
    >
      <div style={{ fontSize: 15 }}>Проект пуст</div>
      <div className="empty-hint" style={{ maxWidth: 380, padding: 0 }}>
        Начните со шкафа: задайте габариты и материал — детали, кромка,
        соединения, присадка и раскрой посчитаются сами.
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button data-testid="empty-create" onClick={onCreateFurniture} title="Создать изделие: шкаф, стеллаж, тумба">
          Создать изделие
        </button>
        <button onClick={onOpenCabinetDesigner} title="Открыть мастер шкафа с параметрами">
          Мастер шкафа
        </button>
      </div>
    </div>
  );
}
