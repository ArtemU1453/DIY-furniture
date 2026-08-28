/**
 * Каталог фурнитуры и размещение (§96–§110, §122–§131).
 *
 * Слева каталог с поиском и фильтрами, в центре диалог размещения с живым
 * предпросмотром, справа установленная фурнитура, схемы и отчёт. Считают
 * движки hardware и machining — панель только показывает и вызывает действия.
 */
import { useMemo, useState } from 'react';
import { useEditorStore } from '@/app/store/editorStore';
import {
  HARDWARE_KINDS,
  catalogManufacturers,
  checkItem,
  createItem,
  diagramToSvg,
  filterCatalog,
  hardwareItemReport,
  hardwareMachiningReport,
  installationDiagram,
  isItemOverridden,
  itemLayout,
  kindSpec,
  localPosition,
  projectItems,
  worldPosition,
} from '@/engines/hardware';
import { allParts } from '@/core/model/selectors';
import type { HardwareKind, PartFace } from '@/core/model/types';
import type { HardwareId, PartId } from '@/core/model/ids';

const FACES: PartFace[] = ['front', 'back', 'left', 'right', 'top', 'bottom'];

export function HardwareCatalogView({ onOpenPart }: { onOpenPart?: (partId: string) => void }) {
  const project = useEditorStore((s) => s.project);
  const catalog = useEditorStore((s) => s.hardwareCatalog);
  const place = useEditorStore((s) => s.placeHardwareItem);
  const move = useEditorStore((s) => s.moveHardwareItem);
  const reset = useEditorStore((s) => s.resetHardwareItem);
  const lock = useEditorStore((s) => s.lockHardwareItem);
  const hide = useEditorStore((s) => s.hideHardwareItem);
  const duplicate = useEditorStore((s) => s.duplicateHardwareItem);
  const mirror = useEditorStore((s) => s.mirrorHardwareItem);
  const remove = useEditorStore((s) => s.removeHardwareItem);
  const group = useEditorStore((s) => s.groupHardwareItems);
  const favorite = useEditorStore((s) => s.toggleHardwareFavorite);
  const duplicateEntry = useEditorStore((s) => s.duplicateHardwareEntry);
  const createCustom = useEditorStore((s) => s.createCustomHardware);
  const addToProject = useEditorStore((s) => s.addCatalogHardwareToProject);
  const exportCatalogJson = useEditorStore((s) => s.exportHardwareCatalogJson);
  const importCatalogJson = useEditorStore((s) => s.importHardwareCatalogJson);

  const [messages, setMessages] = useState<string[]>([]);
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<HardwareKind | ''>('');
  const [manufacturer, setManufacturer] = useState('');
  const [origin, setOrigin] = useState<'' | 'custom' | 'catalog'>('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [partId, setPartId] = useState<string>('');
  const [face, setFace] = useState<PartFace | ''>('');
  const [quantity, setQuantity] = useState('');
  const [offsetX, setOffsetX] = useState('0');
  const [offsetY, setOffsetY] = useState('0');
  const [selected, setSelected] = useState<string[]>([]);

  const note = (text: string) => setMessages((m) => [text, ...m].slice(0, 20));

  const parts = useMemo(() => allParts(project), [project]);
  const entries = useMemo(
    () => filterCatalog(catalog, {
      query,
      kind: kind === '' ? undefined : kind,
      manufacturer: manufacturer === '' ? undefined : manufacturer,
      origin: origin === '' ? undefined : origin,
      favoritesOnly,
    }),
    [catalog, query, kind, manufacturer, origin, favoritesOnly],
  );
  const entry = entries.find((e) => String(e.hardware.id) === entryId) ?? entries[0];
  const activePart = parts.find((p) => String(p.id) === partId) ?? parts[0];

  /** Предпросмотр (§102): то же, что получится после «Применить». */
  const preview = useMemo(() => {
    if (!entry || !activePart) return null;
    const draft = {
      ...project,
      hardware: project.hardware.some((h) => String(h.id) === String(entry.hardware.id))
        ? project.hardware
        : [...project.hardware, entry.hardware],
    };
    const item = createItem(draft, {
      hardwareId: entry.hardware.id as HardwareId,
      partId: activePart.id as PartId,
      kind: entry.kind,
      face: face === '' ? undefined : face,
      quantity: quantity === '' ? undefined : Number(quantity),
    }, 'preview');
    if (!item) return null;
    const moved = {
      ...item,
      override: {
        x: Number(offsetX) || 0,
        y: Number(offsetY) || 0,
      },
    };
    const draftWithItem = { ...draft, hardwareInstances: [...(draft.hardwareInstances ?? []), moved] };
    return {
      item: moved,
      layout: itemLayout(draftWithItem, moved),
      issues: checkItem(draftWithItem, moved),
    };
  }, [project, entry, activePart, face, quantity, offsetX, offsetY]);

  const items = projectItems(project);
  const report = useMemo(() => hardwareItemReport(project), [project]);
  const machining = useMemo(() => hardwareMachiningReport(project), [project]);
  const activeItem = items.find((i) => selected.includes(i.id)) ?? items[0];
  const diagram = useMemo(
    () => (activeItem ? installationDiagram(project, activeItem) : null),
    [project, activeItem],
  );

  const toggleSelected = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }} data-testid="hardware-catalog">
      {/* Каталог: поиск, фильтры, карточки (§96–§98) */}
      <aside style={{ width: 280, borderRight: '1px solid var(--border)', overflow: 'auto', padding: 12 }}>
        <h3 style={hdr}>Каталог фурнитуры</h3>
        <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
          <input
            data-testid="catalog-search"
            placeholder="Поиск: имя, артикул, вид"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 150 }}
          />
          <button data-testid="catalog-view-toggle" onClick={() => setView((v) => (v === 'list' ? 'grid' : 'list'))}>
            {view === 'list' ? 'Плитка' : 'Список'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
          <select data-testid="catalog-kind" value={kind} onChange={(e) => setKind(e.target.value as HardwareKind | '')}>
            <option value="">Все виды</option>
            {HARDWARE_KINDS.map((k) => <option key={k} value={k}>{kindSpec(k).label}</option>)}
          </select>
          <select data-testid="catalog-manufacturer" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)}>
            <option value="">Все производители</option>
            {catalogManufacturers(catalog).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select data-testid="catalog-origin" value={origin} onChange={(e) => setOrigin(e.target.value as '' | 'custom' | 'catalog')}>
            <option value="">Все позиции</option>
            <option value="catalog">Каталог</option>
            <option value="custom">Свои</option>
          </select>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11 }}>
            <input
              type="checkbox"
              data-testid="catalog-favorites"
              checked={favoritesOnly}
              onChange={(e) => setFavoritesOnly(e.target.checked)}
            />
            Избранное
          </label>
        </div>

        <div
          data-testid="catalog-entries"
          style={view === 'grid'
            ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }
            : { display: 'block' }}
        >
          {entries.map((e) => (
            <div
              key={String(e.hardware.id)}
              data-testid="catalog-card"
              onClick={() => setEntryId(String(e.hardware.id))}
              style={{
                border: '1px solid var(--border)', borderRadius: 6, padding: 6, marginBottom: 4,
                cursor: 'pointer',
                background: String(e.hardware.id) === String(entry?.hardware.id) ? 'var(--accent-dim)' : undefined,
              }}
            >
              <div style={{ fontSize: 12 }}>{e.hardware.name}{e.favorite ? ' ★' : ''}</div>
              <div className="dim" style={{ fontSize: 10 }}>
                {kindSpec(e.kind).label} · {e.hardware.article ?? '—'}
              </div>
              <div className="dim" style={{ fontSize: 10 }}>
                {e.hardware.manufacturer ?? '—'}{e.custom ? ' · своя' : ''}
              </div>
            </div>
          ))}
          {entries.length === 0 && <span className="dim" style={{ fontSize: 11 }}>Ничего не найдено.</span>}
        </div>

        <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
          <button data-testid="catalog-favorite" disabled={!entry} onClick={() => {
            if (!entry) return;
            favorite(String(entry.hardware.id));
            note(`Избранное: ${entry.hardware.name}`);
          }}>В избранное</button>
          <button data-testid="catalog-duplicate" disabled={!entry} onClick={() => {
            if (!entry) return;
            const id = duplicateEntry(String(entry.hardware.id));
            note(id ? `Создана копия позиции ${id}` : 'Копия не создана.');
          }}>Копировать</button>
          <button data-testid="catalog-custom" onClick={() => {
            const id = createCustom({
              name: `Своя фурнитура ${catalog.entries.length + 1}`,
              kind: kind === '' ? 'OTHER' : kind,
            });
            note(id ? `Создана позиция ${id}` : 'Позиция не создана.');
          }}>Своя позиция</button>
          <button data-testid="catalog-export" onClick={() => {
            note(`hardware-catalog.json: ${exportCatalogJson().length} байт`);
          }}>Экспорт</button>
          <label style={{ cursor: 'pointer' }}>
            <span className="dim" style={{ fontSize: 11 }}>Импорт каталога</span>
            <input
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              data-testid="catalog-import"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const result = importCatalogJson(await file.text());
                note(result.ok ? `Импортировано позиций: ${result.imported}` : result.errors.join(' '));
              }}
            />
          </label>
        </div>
      </aside>

      {/* Размещение и предпросмотр (§99–§104) */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 12 }}>
        <h3 style={hdr}>Размещение</h3>
        {entry ? (
          <div data-testid="placement-dialog">
            <div className="dim" style={{ fontSize: 11, marginBottom: 6 }}>
              {entry.hardware.name} · {kindSpec(entry.kind).label} ·
              {' '}{entry.hardware.manufacturer ?? '—'} · {entry.hardware.article ?? '—'}
            </div>
            {entry.installation && (
              <div className="dim" style={{ fontSize: 11, marginBottom: 6 }} data-testid="entry-installation">
                {entry.installation}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              <label style={{ fontSize: 11 }}>
                Деталь{' '}
                <select data-testid="placement-part" value={partId} onChange={(e) => setPartId(e.target.value)}>
                  {parts.map((p) => <option key={String(p.id)} value={String(p.id)}>{p.name}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 11 }}>
                Грань{' '}
                <select data-testid="placement-face" value={face} onChange={(e) => setFace(e.target.value as PartFace | '')}>
                  <option value="">По правилу</option>
                  {FACES.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 11 }}>
                Количество{' '}
                <input data-testid="placement-quantity" type="number" style={{ width: 60 }}
                  value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </label>
              <label style={{ fontSize: 11 }}>
                Смещение X{' '}
                <input data-testid="placement-offset-x" type="number" style={{ width: 60 }}
                  value={offsetX} onChange={(e) => setOffsetX(e.target.value)} />
              </label>
              <label style={{ fontSize: 11 }}>
                Смещение Y{' '}
                <input data-testid="placement-offset-y" type="number" style={{ width: 60 }}
                  value={offsetY} onChange={(e) => setOffsetY(e.target.value)} />
              </label>
            </div>

            {preview && (
              <div data-testid="placement-preview" style={{ marginBottom: 8 }}>
                <div className="dim" style={{ fontSize: 11 }}>
                  Опорных точек: {preview.layout?.anchors.length ?? 0} ·
                  {' '}операций: {preview.layout?.operations.length ?? 0}
                </div>
                {preview.issues.map((issue, i) => (
                  <div key={i} data-testid="placement-issue" style={{
                    fontSize: 11,
                    color: issue.severity === 'error' ? 'var(--danger, #a33)' : 'var(--warn, #a70)',
                  }}>{issue.message}</div>
                ))}
              </div>
            )}

            <button data-testid="placement-apply" onClick={() => {
              if (!entry || !activePart) return;
              addToProject(String(entry.hardware.id));
              const result = place({
                hardwareId: entry.hardware.id as HardwareId,
                partId: activePart.id as PartId,
                kind: entry.kind,
                face: face === '' ? undefined : face,
                quantity: quantity === '' ? undefined : Number(quantity),
              });
              if (result.ok && result.itemId && (Number(offsetX) || Number(offsetY))) {
                const base = localPosition(useEditorStore.getState().project, {
                  ...(useEditorStore.getState().project.hardwareInstances ?? [])
                    .find((i) => i.id === result.itemId)!,
                });
                if (base) move(result.itemId, { x: base.x + Number(offsetX), y: base.y + Number(offsetY) });
              }
              note(result.ok
                ? `Фурнитура добавлена: ${result.itemId}`
                : `Не добавлено: ${result.errors.join(' ')}`);
            }}>Добавить в проект</button>
          </div>
        ) : (
          <span className="dim" style={{ fontSize: 11 }}>Выберите позицию каталога.</span>
        )}

        {/* Установленная фурнитура (§89/§90/§108) */}
        <h3 style={{ ...hdr, marginTop: 12 }}>Установлено</h3>
        <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }} data-testid="hardware-items">
          <thead>
            <tr>
              <th style={th} />
              <th style={th}>Фурнитура</th><th style={th}>Деталь</th><th style={th}>Грань</th>
              <th style={th}>Положение</th><th style={th}>Операций</th><th style={th}>Состояние</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const hardware = project.hardware.find((h) => h.id === item.hardwareId);
              const part = parts.find((p) => String(p.id) === String(item.partId));
              const local = localPosition(project, item);
              const world = worldPosition(project, item);
              const layout = itemLayout(project, item);
              return (
                <tr key={item.id} data-testid="hardware-item-row"
                  style={{ background: selected.includes(item.id) ? 'var(--accent-dim)' : undefined }}>
                  <td style={td}>
                    <input type="checkbox" data-testid="item-select"
                      checked={selected.includes(item.id)} onChange={() => toggleSelected(item.id)} />
                  </td>
                  <td style={td}>{hardware?.name ?? item.hardwareId}</td>
                  <td style={td}>
                    {onOpenPart && part
                      ? <button onClick={() => onOpenPart(String(part.id))}>{part.name}</button>
                      : (part?.name ?? '—')}
                  </td>
                  <td style={td}>{local?.face ?? item.face ?? '—'}</td>
                  <td style={td} data-testid="item-position">
                    {local ? `${Math.round(local.x)}, ${Math.round(local.y)}` : '—'}
                    {world && <span className="dim"> · мир {Math.round(world.x)}, {Math.round(world.y)}</span>}
                  </td>
                  <td style={td}>{layout?.operations.length ?? 0}</td>
                  <td style={td}>
                    {isItemOverridden(item) ? 'Override' : 'Авто'}
                    {item.locked ? ' · закреплена' : ''}
                    {item.hidden ? ' · скрыта' : ''}
                  </td>
                  <td style={td}>
                    <button data-testid="item-reset" onClick={() => { reset(item.id); note('Положение сброшено.'); }}>Reset</button>
                    <button data-testid="item-lock" onClick={() => lock(item.id, !item.locked)}>Лок</button>
                    <button data-testid="item-hide" onClick={() => hide(item.id, !item.hidden)}>Вид</button>
                    <button data-testid="item-duplicate" onClick={() => {
                      const id = duplicate(item.id);
                      note(id ? `Копия: ${id}` : 'Копия не создана.');
                    }}>Копия</button>
                    <button data-testid="item-mirror" onClick={() => {
                      const id = mirror(item.id);
                      note(id ? `Зеркало: ${id}` : 'Зеркало не создано.');
                    }}>Зеркало</button>
                    <button data-testid="item-remove" onClick={() => { remove(item.id); note('Фурнитура удалена.'); }}>Удалить</button>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr><td style={td} colSpan={8} className="dim">Фурнитура ещё не установлена.</td></tr>
            )}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
          <button data-testid="items-group" disabled={selected.length === 0} onClick={() => {
            const id = group(`Комплект ${projectItems(project).length}`, selected);
            note(id ? `Создан комплект ${id}` : 'Комплект не создан.');
          }}>Собрать комплект</button>
          <span className="dim" style={{ fontSize: 11 }}>выбрано: {selected.length}</span>
        </div>
      </div>

      {/* Схема, отчёт и присадка (§122–§131) */}
      <aside style={{ width: 300, borderLeft: '1px solid var(--border)', overflow: 'auto', padding: 12 }}>
        <h3 style={hdr}>Монтажная схема</h3>
        {diagram ? (
          <div data-testid="installation-diagram">
            <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>{diagram.title}</div>
            <div dangerouslySetInnerHTML={{ __html: diagramToSvg(diagram, 260) }} />
            {diagram.notes.map((n, i) => (
              <div key={i} className="dim" style={{ fontSize: 10 }}>{n}</div>
            ))}
          </div>
        ) : <span className="dim" style={{ fontSize: 11 }}>Схема появится после установки фурнитуры.</span>}

        <h3 style={{ ...hdr, marginTop: 12 }}>Отчёт по фурнитуре</h3>
        <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }} data-testid="hardware-report">
          <thead>
            <tr><th style={th}>№</th><th style={th}>Название</th><th style={th}>Кол-во</th><th style={th}>Где</th></tr>
          </thead>
          <tbody>
            {report.map((row) => (
              <tr key={row.index}>
                <td style={td}>{row.index}</td>
                <td style={td}>{row.name}</td>
                <td style={td}>{row.quantity}</td>
                <td style={td}>{row.usage.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 style={{ ...hdr, marginTop: 12 }}>Присадка от фурнитуры</h3>
        <div className="dim" style={{ fontSize: 11 }} data-testid="hardware-machining">
          операций: {machining.length}
          {machining.slice(0, 8).map((row, i) => (
            <div key={i}>
              {row.partName} · {row.hardwareName} · {row.face} ·
              {' '}{row.x} / {row.y} · Ø{row.diameter} × {row.depth}
            </div>
          ))}
        </div>

        <h3 style={{ ...hdr, marginTop: 12 }}>Журнал</h3>
        <div data-testid="hardware-log" className="dim" style={{ fontSize: 11 }}>
          {messages.map((m, i) => <div key={i}>{m}</div>)}
        </div>
      </aside>
    </div>
  );
}

const hdr: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-dim)', margin: '0 0 8px',
};
const th: React.CSSProperties = { textAlign: 'left', borderBottom: '1px solid var(--border)', padding: '2px 4px' };
const td: React.CSSProperties = { padding: '2px 4px', borderBottom: '1px solid var(--border)' };
