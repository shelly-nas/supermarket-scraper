import React, { useState } from 'react';
import { ProductWithDiscount } from '../types';
import { format, isValid, parseISO } from 'date-fns';
import { EmptyState } from './PageState';
import { ExternalLinkIcon, FilterIcon, ImageIcon } from './Icons';
import './DatabaseTable.css';

// Product images come through the scraper API's image proxy (cached there).
const imageUrl = (productId: number) => `/api/public/v1/images/${productId}`;

const ProductThumbnail: React.FC<{ productId: number; hasImage: boolean; name: string }> = ({
  productId,
  hasImage,
  name,
}) => {
  const [failed, setFailed] = useState(false);
  if (!hasImage || failed) {
    return (
      <span className="product-thumb product-thumb-empty" aria-hidden="true">
        <ImageIcon />
      </span>
    );
  }
  return (
    <img
      className="product-thumb"
      src={imageUrl(productId)}
      alt={name}
      loading="lazy"
      width={40}
      height={40}
      onError={() => setFailed(true)}
    />
  );
};

interface DatabaseTableProps {
  data: ProductWithDiscount[];
  loading?: boolean;
  columnFilters: Record<string, string>;
  onColumnFilterChange: (column: string, value: string) => void;
  onClearFilters: () => void;
}

const columns = [
  { key: 'category', label: 'Category', width: '180px' },
  { key: 'name', label: 'Product name', width: 'auto' },
  { key: 'supermarket', label: 'Supermarket', width: '140px' },
  { key: 'discount.discount_price', label: 'Discount price', width: '140px', numeric: true },
  { key: 'discount.original_price', label: 'Original price', width: '140px', numeric: true },
  { key: 'discount.special_discount', label: 'Special discount', width: '160px' },
  { key: 'discount.expire_date', label: 'Expire date', width: '140px' },
];

const SKELETON_ROWS = 8;

const DatabaseTable: React.FC<DatabaseTableProps> = ({
  data,
  loading = false,
  columnFilters,
  onColumnFilterChange,
  onClearFilters,
}) => {
  const [showColumnFilters, setShowColumnFilters] = useState<string[]>([]);

  const formatDate = (dateString: string) => {
    try {
      const date = parseISO(dateString);
      if (isValid(date)) {
        return format(date, 'MMM dd, yyyy');
      }
      return dateString;
    } catch {
      return dateString;
    }
  };

  const formatPrice = (price: number) => {
    return `€${price.toFixed(2)}`;
  };

  const toggleColumnFilter = (column: string) => {
    setShowColumnFilters(prev =>
      prev.includes(column)
        ? prev.filter(c => c !== column)
        : [...prev, column]
    );
  };

  const getCellValue = (item: ProductWithDiscount, columnKey: string): React.ReactNode => {
    if (columnKey === 'discount.expire_date') {
      return formatDate(item.discount.expire_date);
    } else if (columnKey === 'category') {
      return item.category;
    } else if (columnKey === 'name') {
      return (
        <span className="product-name-cell">
          <ProductThumbnail productId={item.id} hasImage={!!item.image_url} name={item.name} />
          <span className="product-name">{item.name}</span>
          {item.product_url && (
            <a
              href={item.product_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-quiet btn-sm icon-btn product-link"
              aria-label={`View ${item.name} on the supermarket website`}
              title="View on supermarket website"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLinkIcon />
            </a>
          )}
        </span>
      );
    } else if (columnKey === 'supermarket') {
      return item.supermarket;
    } else if (columnKey === 'discount.discount_price') {
      return <span className="t-strong">{formatPrice(item.discount.discount_price)}</span>;
    } else if (columnKey === 'discount.original_price') {
      return formatPrice(item.discount.original_price);
    } else if (columnKey === 'discount.special_discount') {
      return item.discount.special_discount || '—';
    }
    return '—';
  };

  const hasFilters = Object.values(columnFilters).some(Boolean);

  return (
    <div className="table-wrap database-table-scroll">
      <table className="table database-table" aria-busy={loading}>
        <thead>
          <tr>
            {columns.map((column) => {
              const filterOpen = showColumnFilters.includes(column.key);
              const filterSet = !!columnFilters[column.key];
              return (
                <th
                  key={column.key}
                  className={column.numeric ? 'num' : undefined}
                  style={{ width: column.width }}
                >
                  <div className="header-content">
                    <span className="header-label">{column.label}</span>
                    <button
                      type="button"
                      className={`btn btn-quiet btn-sm icon-btn filter-toggle-button${filterOpen || filterSet ? ' is-active' : ''}`}
                      onClick={() => toggleColumnFilter(column.key)}
                      aria-label={`Filter ${column.label.toLowerCase()}`}
                      aria-expanded={filterOpen}
                      title="Filter column"
                    >
                      <FilterIcon />
                    </button>
                  </div>
                  {filterOpen && (
                    <div className="column-filter">
                      <input
                        type="text"
                        className="input column-filter-input"
                        aria-label={`Filter ${column.label.toLowerCase()}`}
                        placeholder={`Filter ${column.label.toLowerCase()}…`}
                        value={columnFilters[column.key] || ''}
                        onChange={(e) => onColumnFilterChange(column.key, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    </div>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: SKELETON_ROWS }, (_, row) => (
              <tr key={row} className="skeleton-row">
                {columns.map((column) => (
                  <td key={column.key} className={column.numeric ? 'num' : undefined}>
                    {column.key === 'name' ? (
                      <span className="product-name-cell">
                        <span className="skel thumb-skel" />
                        <span className="skel skel-line" style={{ width: `${60 + ((row * 7) % 30)}%` }} />
                      </span>
                    ) : (
                      <span className="skel skel-line" />
                    )}
                  </td>
                ))}
              </tr>
            ))
          ) : data.length === 0 ? (
            <tr className="empty-row">
              <td colSpan={columns.length}>
                {hasFilters ? (
                  <EmptyState
                    title="No discounts match your filters"
                    message="Nothing matches the search and column filters. Clear them to see all current discounts."
                  >
                    <button type="button" className="btn btn-secondary" onClick={onClearFilters}>
                      Clear filters
                    </button>
                  </EmptyState>
                ) : (
                  <EmptyState
                    title="No discounts yet"
                    message="Discounts appear here after an offers run. Start one for a supermarket under Configuraties."
                  />
                )}
              </td>
            </tr>
          ) : (
            data.map((item) => (
              <tr key={item.id}>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={[column.numeric && 'num', column.key === 'name' && 'cell-name']
                      .filter(Boolean)
                      .join(' ') || undefined}
                  >
                    {getCellValue(item, column.key)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

export default DatabaseTable;
