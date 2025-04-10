import { type PropsWithChildren, useEffect, useState } from 'react';
import { CoepStatus, checkCoepStatus } from 'gtfs-sqlite';

export const CoepGateway: React.FC<PropsWithChildren> = ({ children }) => {
  const [status, setStatus] = useState<CoepStatus>();

  useEffect(() => {
    checkCoepStatus().then(setStatus);
  }, []);

  switch (status) {
    case undefined: {
      return <>loading...</>;
    }

    case CoepStatus.ERROR: {
      return (
        <>
          Failed to establish a secure browsing context, which is required to
          use SharedArrayBuffer.
        </>
      );
    }

    case CoepStatus.NEEDS_RELOAD: {
      return (
        <>
          Please{' '}
          <button type="button" onClick={() => window.location.reload()}>
            reload the page
          </button>{' '}
          to enable the service-worker. This will not work in private/incognito
          mode.
        </>
      );
    }

    case CoepStatus.OK: {
      return children;
    }

    default: {
      return status satisfies never; // exhaustivity check
    }
  }
};
