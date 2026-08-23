import { describe, it, expect } from 'vitest';
import { createProject, createPart } from '@/core/model/factory';
import {
  serializeProject,
  deserializeProject,
  ProjectParseError,
} from '@/storage/project/serialization';
import { firstAssembly } from '@/core/model/selectors';

describe('Serialization — round-trip Project → JSON → Project', () => {
  it('восстанавливает проект без потерь', () => {
    const project = createProject({ name: 'Проект A' });
    const assembly = firstAssembly(project)!;
    assembly.parts.push(createPart({ name: 'Боковина', width: 800, height: 2000, thickness: 16 }));

    const json = serializeProject(project);
    const restored = deserializeProject(json);

    expect(restored).toEqual(project);
    expect(restored.furnitures[0].assemblies[0].parts[0].name).toBe('Боковина');
  });

  it('сохраняет изменённые размеры после импорта', () => {
    const project = createProject();
    const assembly = firstAssembly(project)!;
    const part = createPart({ width: 800 });
    part.width = 900;
    assembly.parts.push(part);

    const restored = deserializeProject(serializeProject(project));
    expect(restored.furnitures[0].assemblies[0].parts[0].width).toBe(900);
  });

  it('отклоняет некорректный JSON', () => {
    expect(() => deserializeProject('{ not json')).toThrow(ProjectParseError);
  });

  it('отклоняет объект без обязательных полей', () => {
    expect(() => deserializeProject('{"version":"1.0","id":"x","name":"y"}')).toThrow(
      ProjectParseError,
    );
  });

  it('отклоняет несовместимую версию формата', () => {
    const project = createProject();
    const bad = { ...project, version: '2.0' };
    expect(() => deserializeProject(JSON.stringify(bad))).toThrow(/версия/i);
  });
});
