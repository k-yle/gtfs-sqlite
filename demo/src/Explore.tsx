import { useMemo, useState } from 'react';
import { CommsChannel } from 'gtfs-sqlite';
import { Editor, loader } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
// eslint-disable-next-line import-x/no-extraneous-dependencies -- peer dep
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import exampleFile from './examples.sql?raw';

window.self.MonacoEnvironment = {
  getWorker: (_, label) =>
    label === 'json' ? new JsonWorker() : new EditorWorker(),
};
loader.config({ monaco });
loader.init();

const examples = exampleFile.split('\n\n---\n\n');
const getExample = () => examples[Math.round(Math.random() * examples.length)];

export const Explore: React.FC<{ databaseName: string; onBack(): void }> = ({
  databaseName,
  onBack,
}) => {
  const comms = useMemo(() => CommsChannel(databaseName), [databaseName]);
  const [left, setLeft] = useState<editor.IStandaloneCodeEditor>();
  const [result, setResult] = useState<unknown>();
  const [isLoading, setIsLoading] = useState(false);

  function execute() {
    setIsLoading(true);
    comms
      .exec(left?.getModel()?.getValue() || '')
      .then(setResult)
      .catch(setResult)
      .then(() => setIsLoading(false));
  }

  function loadExample() {
    const current = left?.getModel()?.getValue();
    // ensure that we don't pick the same as the current example
    let example: string;
    do example = getExample();
    while (!example || current === example);

    left?.getModel()?.setValue(example);
  }

  return (
    <div style={{ display: 'flex' }}>
      <div>
        <header
          style={{
            height: 50,
            padding: 12,
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <button type="button" onClick={onBack}>
            Back
          </button>
          <button type="button" onClick={loadExample}>
            Load Random Example
          </button>
          <button type="button" onClick={execute} disabled={isLoading}>
            {isLoading ? 'Executing…' : 'Execute'}
          </button>
        </header>
        <Editor
          height="calc(100vh - 50px)"
          width="50vw"
          language="sql"
          defaultValue="SELECT * FROM stops "
          theme="vs-dark"
          onMount={(editor) => setLeft(editor)}
        />
      </div>
      <div style={{ marginTop: 50 }}>
        <Editor
          height="calc(100vh - 50px)"
          width="50vw"
          language="json"
          options={{ readOnly: true }}
          theme="vs-dark"
          value={JSON.stringify(
            result instanceof Error ? result.message : result,
            null,
            2,
          )}
        />
      </div>
    </div>
  );
};
