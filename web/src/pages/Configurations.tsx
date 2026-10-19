import React, { useState, useEffect } from 'react';
import { configurationsService } from '../services/api';
import { ConfigurationsStats, SupermarketStatus, ScraperRun } from '../types';
import ConfirmDialog from '../components/ConfirmDialog';
import CatalogSection from '../components/CatalogSection';
import StatusBadge from '../components/StatusBadge';
import { EmptyState, ErrorAlert, ErrorState } from '../components/PageState';
import { AlertIcon, ChevronLeftIcon, ChevronRightIcon } from '../components/Icons';
import './Configurations.css';

const Configurations: React.FC = () => {
  const [stats, setStats] = useState<ConfigurationsStats | null>(null);
  const [statuses, setStatuses] = useState<SupermarketStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    supermarket: string;
    supermarketKey: string;
  }>({
    isOpen: false,
    supermarket: '',
    supermarketKey: '',
  });
  const [runningScrapers, setRunningScrapers] = useState<Set<string>>(new Set());
  const [togglingSchedule, setTogglingSchedule] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  
  // Logs state
  const [runs, setRuns] = useState<ScraperRun[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const RUNS_PER_PAGE = 10;

  useEffect(() => {
    loadConfigurationsData();
    loadLogs();
    // Refresh data every 30 seconds
    const interval = setInterval(() => {
      loadConfigurationsData();
      loadLogs();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadConfigurationsData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [configurationsStats, supermarketStatuses] = await Promise.all([
        configurationsService.getStats(),
        configurationsService.getStatuses(),
      ]);
      setStats(configurationsStats);
      setStatuses(supermarketStatuses);
    } catch (err) {
      setError('Failed to load configurations data.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadLogs = async () => {
    try {
      setLogsLoading(true);
      setLogsError(null);
      // Load more runs than we need for pagination (e.g., 50 runs)
      const scraperRuns = await configurationsService.getScraperRuns(50);
      setRuns(scraperRuns);
    } catch (err) {
      setLogsError('Failed to load scraper logs.');
      console.error(err);
    } finally {
      setLogsLoading(false);
    }
  };

  const handleRunScraper = (supermarket: string, supermarketKey: string) => {
    setConfirmDialog({
      isOpen: true,
      supermarket,
      supermarketKey,
    });
  };

  const confirmRunScraper = async () => {
    const { supermarketKey } = confirmDialog;
    setConfirmDialog({ isOpen: false, supermarket: '', supermarketKey: '' });
    
    // Add to running scrapers
    setRunningScrapers(prev => new Set(prev).add(supermarketKey));
    
    try {
      await configurationsService.runScraper(supermarketKey);
      // Reload data after scraper completes
      await loadConfigurationsData();
      await loadLogs(); // Also reload logs to show the new run
    } catch (err) {
      console.error('Failed to run scraper:', err);
      setActionError('The offers run failed. Check the scraper run logs below for the cause.');
    } finally {
      // Remove from running scrapers
      setRunningScrapers(prev => {
        const newSet = new Set(prev);
        newSet.delete(supermarketKey);
        return newSet;
      });
    }
  };

  const cancelRunScraper = () => {
    setConfirmDialog({ isOpen: false, supermarket: '', supermarketKey: '' });
  };

  const handleToggleSchedule = async (supermarketKey: string, currentlyEnabled: boolean) => {
    setTogglingSchedule(prev => new Set(prev).add(supermarketKey));
    try {
      await configurationsService.toggleScheduledRun(supermarketKey, !currentlyEnabled);
      await loadConfigurationsData();
    } catch (err) {
      console.error('Failed to toggle scheduled run:', err);
      setActionError('Could not change the automatic re-scrape. Try again in a moment.');
    } finally {
      setTogglingSchedule(prev => {
        const next = new Set(prev);
        next.delete(supermarketKey);
        return next;
      });
    }
  };

  const isExpired = (expireDate: string | null | undefined): boolean => {
    if (!expireDate) return false;
    return new Date(expireDate) < new Date();
  };

  // Pagination helpers
  const totalPages = Math.ceil(runs.length / RUNS_PER_PAGE);
  const startIndex = (currentPage - 1) * RUNS_PER_PAGE;
  const endIndex = startIndex + RUNS_PER_PAGE;
  const currentRuns = runs.slice(startIndex, endIndex);

  const handlePreviousPage = () => {
    setCurrentPage(prev => Math.max(1, prev - 1));
  };

  const handleNextPage = () => {
    setCurrentPage(prev => Math.min(totalPages, prev + 1));
  };

  const formatDuration = (durationSeconds: number | null | undefined): string => {
    if (!durationSeconds) return '—';
    const minutes = Math.floor(durationSeconds / 60);
    const remainingSeconds = durationSeconds % 60;
    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${durationSeconds}s`;
  };


  const formatNextRun = (iso: string) =>
    new Date(iso).toLocaleString('nl-NL', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  const formatCount = (value: number | undefined) => (value || 0).toLocaleString('nl-NL');

  const pageHeader = (
    <header className="page-header">
      <div className="page-header-text">
        <h1 className="t-title">Configuraties</h1>
        <p className="t-small">Monitor your scraper performance</p>
      </div>
    </header>
  );

  if (loading && !stats) {
    return (
      <div className="configurations" aria-busy="true">
        {pageHeader}
        <div className="kpi-grid">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="card kpi-card">
              <span className="skel skel-line" style={{ width: '50%' }} />
              <span className="skel kpi-value-skel" />
            </div>
          ))}
        </div>
        <section className="page-section">
          <div className="supermarket-grid">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="card supermarket-card">
                <span className="skel skel-line" style={{ width: '40%' }} />
                <span className="skel skel-line" style={{ width: '70%' }} />
                <span className="skel skel-line" style={{ width: '55%' }} />
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="configurations">
        {pageHeader}
        <div className="card">
          <ErrorState
            title="Couldn't load configurations"
            message="The scraper API did not answer. Scheduled runs keep going on the server; try again in a moment."
          >
            <button type="button" onClick={loadConfigurationsData} className="btn btn-primary">
              Try again
            </button>
          </ErrorState>
        </div>
      </div>
    );
  }

  return (
    <div className="configurations">
      {pageHeader}

      {actionError && <ErrorAlert message={actionError} onDismiss={() => setActionError(null)} />}

      {/* KPI Cards */}
      <div className="kpi-grid">
        <div className="card kpi-card">
          <span className="t-label">Total runs</span>
          <span className="kpi-value">{formatCount(stats?.totalRuns)}</span>
        </div>
        <div className="card kpi-card">
          <span className="t-label">Success rate</span>
          <span className="kpi-value">{stats?.successRate || 0}%</span>
        </div>
        <div className="card kpi-card">
          <span className="t-label">Scraped products</span>
          <span className="kpi-value">{formatCount(stats?.scrapedProducts)}</span>
        </div>
        <div className="card kpi-card">
          <span className="t-label">Unique products</span>
          <span className="kpi-value">{formatCount(stats?.uniqueProducts)}</span>
        </div>
      </div>

      {/* Next Scheduled Run */}
      {stats?.nextScheduledRun && (
        <div className="card schedule-card">
          <span className="t-label">Next scheduled run</span>
          <span className="t-strong">{stats.nextScheduledRun}</span>
        </div>
      )}

      {/* Weekly offers */}
      <section className="page-section">
        <div className="section-header">
          <h2 className="t-heading">Weekly offers</h2>
          <p className="t-small">
            Current discounts. The weekly auto run starts the day after they end, at 03:00: the
            catalog first, then the new offers
          </p>
        </div>
        <div className="supermarket-grid">
          {statuses.map((status) => {
            const isRunning = runningScrapers.has(status.key);
            const isToggling = togglingSchedule.has(status.key);
            const displayStatus = isRunning ? 'running' : status.status;
            const expired = isExpired(status.promotionExpireDate);
            const scheduledEnabled = status.scheduledEnabled ?? false;

            return (
              <div key={status.key} className="card supermarket-card">
                <div className="supermarket-header">
                  <h3 className="supermarket-name">{status.name}</h3>
                  <StatusBadge status={displayStatus} />
                </div>
                <dl className="supermarket-meta">
                  {status.lastRun && (
                    <div>
                      <dt>Last run</dt>
                      <dd>{new Date(status.lastRun).toLocaleString('nl-NL')}</dd>
                    </div>
                  )}
                  {status.productsScraped !== undefined && (
                    <div>
                      <dt>Products</dt>
                      <dd className="num">{status.productsScraped}</dd>
                    </div>
                  )}
                  {status.nextRunAt && scheduledEnabled && (
                    <div>
                      <dt>Next run</dt>
                      <dd>{formatNextRun(status.nextRunAt)}</dd>
                    </div>
                  )}
                  {status.promotionExpireDate && (
                    <div>
                      <dt>{expired ? 'Expired' : 'Expires'}</dt>
                      <dd className={expired ? 'meta-warning' : undefined}>
                        {expired && <AlertIcon />}
                        {new Date(status.promotionExpireDate).toLocaleDateString('nl-NL')}
                      </dd>
                    </div>
                  )}
                </dl>
                <div className="card-actions">
                  <button
                    type="button"
                    className={`btn btn-secondary${isRunning ? ' is-loading' : ''}`}
                    onClick={() => handleRunScraper(status.name, status.key)}
                    disabled={isRunning}
                  >
                    {isRunning ? (
                      <>
                        <span className="spinner" aria-hidden="true" />
                        Running…
                      </>
                    ) : (
                      'Run offers'
                    )}
                  </button>
                  {status.promotionExpireDate != null && (
                    <label
                      className="switch"
                      title="Every week when the offers end: the catalog first, then the new offers"
                    >
                      <input
                        type="checkbox"
                        checked={scheduledEnabled}
                        disabled={isToggling}
                        onChange={() => handleToggleSchedule(status.key, scheduledEnabled)}
                      />
                      <span className="switch-track" />
                      Weekly auto run
                    </label>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Full catalog scrapes */}
      <CatalogSection />

      {/* Scraper Run Logs */}
      <section className="page-section">
        <div className="section-header">
          <h2 className="t-heading">Scraper run logs</h2>
          <p className="t-small">The last 50 offers runs, newest first</p>
        </div>

        {logsError && (
          <ErrorAlert
            message="Could not load the scraper run logs."
            actionLabel="Try again"
            onDismiss={loadLogs}
          />
        )}

        <div className="card logs-card">
          {logsLoading && runs.length === 0 ? (
            <div className="logs-skeleton" aria-busy="true">
              {Array.from({ length: 5 }, (_, i) => (
                <span key={i} className="skel skel-line" />
              ))}
            </div>
          ) : runs.length === 0 ? (
            <EmptyState
              title="No scraper runs yet"
              message="Every offers run is logged here with its duration and results. Start one with Run offers above."
            />
          ) : (
            <div className="table-wrap">
              <table className="table logs-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Supermarket</th>
                    <th>Status</th>
                    <th className="num">Duration</th>
                    <th className="num">Products</th>
                    <th className="num">Discounts</th>
                  </tr>
                </thead>
                <tbody>
                  {currentRuns.map((run) => (
                    <tr key={run.id}>
                      <td className="log-time">
                        {new Date(run.startedAt).toLocaleString('nl-NL', {
                          dateStyle: 'short',
                          timeStyle: 'medium',
                        })}
                      </td>
                      <td className="t-strong">
                        {run.supermarket.charAt(0).toUpperCase() + run.supermarket.slice(1)}
                      </td>
                      <td>
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="num">{formatDuration(run.durationSeconds)}</td>
                      <td className="num">
                        {run.productsScraped || 0} / {run.productsCreated || 0} / {run.productsUpdated || 0}
                        <span className="log-subtitle">scraped / added / updated</span>
                      </td>
                      <td className="num">
                        {run.discountsCreated || 0} / {run.discountsDeactivated || 0}
                        <span className="log-subtitle">created / deactivated</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <nav className="pagination" aria-label="Scraper run log pages">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handlePreviousPage}
              disabled={currentPage === 1}
            >
              <ChevronLeftIcon />
              Previous
            </button>
            <span className="t-small pagination-info">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleNextPage}
              disabled={currentPage === totalPages}
            >
              Next
              <ChevronRightIcon />
            </button>
          </nav>
        )}
      </section>

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title="Run offers now?"
        message={`This fetches the current offers for ${confirmDialog.supermarket} from its website.`}
        confirmText="Run offers"
        cancelText="Cancel"
        onConfirm={confirmRunScraper}
        onCancel={cancelRunScraper}
      />
    </div>
  );
};

export default Configurations;
