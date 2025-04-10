import { useState } from 'react';
import { importDBFromZip } from 'gtfs-sqlite';

const DEMO = {
  name: 'Auckland, New Zealand',
  url: 'https://gtfs.at.govt.nz/gtfs.zip',
};

export const Import: React.FC<{
  onComplete(newId: string | undefined): void;
}> = ({ onComplete }) => {
  const [error, setError] = useState<unknown>();
  const [progress, setProgress] = useState<importDBFromZip.Progress>();

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    try {
      const file = event.target.files?.[0];
      if (!file) return;

      // eslint-disable-next-line no-alert
      const databaseName = prompt(
        'Enter a name for this GTFS feed',
      )?.replaceAll(' ', '_');
      if (!databaseName) return;

      await importDBFromZip({
        zipFile: file,
        databaseName,
        onProgress: setProgress,
        exclude: ['shapes.txt'],
      });
      onComplete(databaseName);
    } catch (ex) {
      console.error(ex);
      setError(ex);
    }
    setProgress(undefined);
  }

  const back = (
    <button type="button" onClick={() => onComplete(undefined)}>
      Back
    </button>
  );

  if (error) {
    return (
      <>
        {back}
        <br />
        cannot import: {`${error}`}
      </>
    );
  }

  if (progress) {
    return (
      <>
        {back}
        <br />
        Importing: <strong>{progress.message}</strong>
        <br />
        {!!progress.warnings.size && (
          <>
            <h3>Warnings</h3>
            <ul>
              {[...progress.warnings].map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </>
        )}
        <h3>Files</h3>
        <ul>
          {Object.entries(progress.perFile).map(([file, { done, total }]) => (
            <li key={file}>
              {file}:{' '}
              {total
                ? `${
                    done ? (done === total ? '✅' : '🚧') : '❌'
                  } ${done.toLocaleString()}/${total.toLocaleString()} (${Math.round((done / total) * 100)}%)`
                : 'enqueued'}
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <>
      {back}
      <br />
      To start, download a GTFS <code>.zip</code> file, for example{' '}
      <a href={DEMO.url} target="_blank" rel="noreferrer">
        this one for {DEMO.name}.
      </a>
      . Once the file is downloaded, come back to this page and upload it.
      <br />
      <br />
      <input accept="*.zip" type="file" onChange={onChange} />
    </>
  );
};
