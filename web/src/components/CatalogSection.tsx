import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { catalogService } from '../services/api';
import { CatalogStatus } from '../types';
import StatusBadge, { RunStatus } from './StatusBadge';
import { ErrorAlert } from './PageState';

/**
 * Full catalog scrapes (regular prices) per supermarket. Runs take minutes and
 * happen in the background, so the section polls while one is running.
 */
const CatalogSection: React.FC = () => {
  const [statuses, setStatuses] = useState<CatalogStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      setStatuses(await catalogService.getStatus());
      setError(null);
    } catch (err) {
      setError('Failed to load catalog status.');
      console.error(err);
    }
  }, []);

  const anyRunning = statuses.some((s) => s.running);

  useEffect(() => {
    load();
    const interval = setInterval(load, anyRunning ? 5000 : 30000);
    return () => clearInterval(interval);
  }, [load, anyRunning]);

  const start = async (key: string) => {
    setStarting((prev) => new Set(prev).add(key));
    try {
      await catalogService.run(key);
    } catch (err) {
      const message = axios.isAxiosError(err) ? err.response?.data?.error : undefined;
      setError(message ?? 'Failed to start the catalog run.');
    } finally {
      setStarting((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      load();
    }
  };

  const supported = statuses.filter((s) => s.supported);
  const unsupported = statuses.filter((s) => !s.supported);

  return (
    <section className="page-section">
      <div className="section-header">
        <h2 className="t-heading">Full assortment</h2>
        <p className="t-small">All products at regular price, every Monday 03:17</p>
      </div>
      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}
      <div className="supermarket-grid">
        {supported.map((s) => {
          const status: RunStatus = s.running ? 'running' : s.lastRun?.status ?? 'pending';
          const busy = s.running || starting.has(s.key);
          return (
            <div key={s.key} className="card supermarket-card">
              <div className="supermarket-header">
                <h3 className="supermarket-name">{s.name}</h3>
                <StatusBadge status={status} />
              </div>
              <dl className="supermarket-meta">
                <div>
                  <dt>In catalog</dt>
                  <dd className="num">{s.productsInCatalog}</dd>
                </div>
                {s.lastRun && (
                  <div>
                    <dt>Last run</dt>
                    <dd>{new Date(s.lastRun.started_at).toLocaleString('nl-NL')}</dd>
                  </div>
                )}
                {s.lastRun?.status === 'success' && (
                  <div>
                    <dt>Result</dt>
                    <dd>
                      {s.lastRun.products_seen} products, {s.lastRun.prices_changed} price changes
                    </dd>
                  </div>
                )}
              </dl>
              {s.lastRun?.status === 'failed' && s.lastRun.error_message && (
                <p className="supermarket-error">{s.lastRun.error_message}</p>
              )}
              <div className="card-actions">
                <button
                  type="button"
                  className={`btn btn-secondary${busy ? ' is-loading' : ''}`}
                  onClick={() => start(s.key)}
                  disabled={busy}
                >
                  {busy ? (
                    <>
                      <span className="spinner" aria-hidden="true" />
                      {s.running ? 'Running…' : 'Starting…'}
                    </>
                  ) : (
                    'Run catalog'
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {unsupported.length > 0 && (
        <p className="t-small catalog-note">
          No assortment scraper yet: {unsupported.map((s) => s.name).join(', ')}. Only their
          weekly offers are available.
        </p>
      )}
    </section>
  );
};

export default CatalogSection;
