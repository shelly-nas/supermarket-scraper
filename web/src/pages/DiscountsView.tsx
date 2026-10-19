import React, { useState, useEffect, useMemo } from 'react';
import { ProductWithDiscount } from '../types';
import DatabaseTable from '../components/DatabaseTable';
import SearchBar from '../components/SearchBar';
import { ErrorState } from '../components/PageState';
import { discountService } from '../services/api';
import './DiscountsView.css';

const DiscountsView: React.FC = () => {
  const [data, setData] = useState<ProductWithDiscount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filter states
  const [globalSearch, setGlobalSearch] = useState('');
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({
    'discount.expire_date': '',
    'category': '',
    'name': ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const discounts = await discountService.getAllDiscounts();
      setData(discounts);
    } catch (err) {
      setError('Failed to load discounts.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Filter data based on all filters
  const filteredData = useMemo(() => {
    let filtered = [...data];

    // Apply global search across all columns
    if (globalSearch) {
      const searchLower = globalSearch.toLowerCase();
      filtered = filtered.filter(item => {
        return (
          item.name?.toLowerCase().includes(searchLower) ||
          item.category?.toLowerCase().includes(searchLower) ||
          item.supermarket?.toLowerCase().includes(searchLower) ||
          item.discount?.discount_price?.toString().includes(searchLower) ||
          item.discount?.original_price?.toString().includes(searchLower) ||
          item.discount?.special_discount?.toLowerCase().includes(searchLower) ||
          item.discount?.expire_date?.toLowerCase().includes(searchLower)
        );
      });
    }

    // Apply column-specific filters
    Object.entries(columnFilters).forEach(([column, value]) => {
      if (value) {
        const searchLower = value.toLowerCase();
        filtered = filtered.filter(item => {
          if (column === 'discount.expire_date') {
            return item.discount?.expire_date?.toLowerCase().includes(searchLower);
          } else if (column === 'category') {
            return item.category?.toLowerCase().includes(searchLower);
          } else if (column === 'name') {
            return item.name?.toLowerCase().includes(searchLower);
          } else if (column === 'supermarket') {
            return item.supermarket?.toLowerCase().includes(searchLower);
          } else if (column === 'discount.discount_price') {
            return item.discount?.discount_price?.toString().includes(searchLower);
          } else if (column === 'discount.original_price') {
            return item.discount?.original_price?.toString().includes(searchLower);
          } else if (column === 'discount.special_discount') {
            return item.discount?.special_discount?.toLowerCase().includes(searchLower);
          }
          return true;
        });
      }
    });

    // Sort by expire date (ascending), then category, then name
    filtered.sort((a, b) => {
      // First sort by expire date
      const dateA = new Date(a.discount.expire_date).getTime();
      const dateB = new Date(b.discount.expire_date).getTime();
      if (dateA !== dateB) return dateA - dateB;

      // Then by category
      const categoryCompare = a.category.localeCompare(b.category);
      if (categoryCompare !== 0) return categoryCompare;

      // Finally by name
      return a.name.localeCompare(b.name);
    });

    return filtered;
  }, [data, globalSearch, columnFilters]);

  const handleColumnFilterChange = (column: string, value: string) => {
    setColumnFilters(prev => ({
      ...prev,
      [column]: value
    }));
  };

  const handleClearAllFilters = () => {
    setGlobalSearch('');
    setColumnFilters({
      'discount.expire_date': '',
      'category': '',
      'name': ''
    });
  };

  const hasColumnFilters = Object.values(columnFilters).some(Boolean);

  return (
    <div className="discounts-view">
      <header className="page-header">
        <div className="page-header-text">
          <h1 className="t-title">Discount database</h1>
          <p className="t-small">
            {loading
              ? 'Loading current discounts…'
              : `${filteredData.length} ${filteredData.length === 1 ? 'item' : 'items'}`}
          </p>
        </div>
        <SearchBar
          value={globalSearch}
          onChange={setGlobalSearch}
          onClear={handleClearAllFilters}
          hasFilters={hasColumnFilters}
          placeholder="Search in all columns…"
        />
      </header>

      <div className="card discounts-content">
        {error ? (
          <ErrorState
            title="Couldn't load discounts"
            message="The scraper API did not answer. The stored discounts are safe; try again in a moment."
          >
            <button type="button" onClick={loadData} className="btn btn-primary">
              Try again
            </button>
          </ErrorState>
        ) : (
          <DatabaseTable
            data={filteredData}
            loading={loading}
            columnFilters={columnFilters}
            onColumnFilterChange={handleColumnFilterChange}
            onClearFilters={handleClearAllFilters}
          />
        )}
      </div>
    </div>
  );
};

export default DiscountsView;
