import { useCallback, useEffect, useState } from 'react';
import { getAllDatabaseNames } from 'gtfs-sqlite';
import { Import } from './Import';
import { Explore } from './Explore';
import { CoepGateway } from './CoepGateway';

const createNew = Symbol('createNew');

const Main: React.FC = () => {
  const [error, setError] = useState<unknown>();
  const [databaseNames, setDatabaseNames] = useState<string[]>();
  const [activeId, setActiveId] = useState<string | typeof createNew>();

  const update = useCallback(() => {
    getAllDatabaseNames().then(setDatabaseNames).catch(setError);
  }, []);

  useEffect(update);

  if (activeId === createNew) {
    return (
      <Import
        onComplete={(newId) => {
          update();
          setActiveId(newId);
        }}
      />
    );
  }

  if (activeId) {
    return (
      <Explore databaseName={activeId} onBack={() => setActiveId(undefined)} />
    );
  }

  if (error) return <>Error: {error}</>;
  if (!databaseNames) return <>Loading…</>;

  return (
    <>
      This is a quick demo of <strong>gtfs-sqlite</strong> (see{' '}
      <a
        href="https://github.com/k-yle/gtfs-sqlite"
        target="_blank"
        rel="noreferrer"
      >
        GitHub
      </a>{' '}
      and{' '}
      <a href="https://npm.im/gtfs-sqlite" target="_blank" rel="noreferrer">
        npm
      </a>
      ). You can import a GTFS file and run database queries, completely within
      your web browser (no third-party server).
      <br />
      <br />
      {!!databaseNames.length && (
        <>
          Existing Databases:
          <ul>
            {databaseNames.map((databaseName) => (
              <li key={databaseName}>
                <button type="button" onClick={() => setActiveId(databaseName)}>
                  {databaseName}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <br />
      <button type="button" onClick={() => setActiveId(createNew)}>
        Import a new database
      </button>
    </>
  );
};

export const App: React.FC = () => (
  <CoepGateway>
    <Main />
  </CoepGateway>
);
