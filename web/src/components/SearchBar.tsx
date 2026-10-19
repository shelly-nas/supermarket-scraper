import React from 'react';
import { CloseIcon, SearchIcon } from './Icons';
import './SearchBar.css';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  placeholder?: string;
  /** Show the clear button also when only other filters are set. */
  hasFilters?: boolean;
}

const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  onClear,
  placeholder = 'Search…',
  hasFilters = false,
}) => {
  return (
    <div className="search-bar input-wrap">
      <SearchIcon />
      <label htmlFor="global-search" className="visually-hidden">
        Search
      </label>
      <input
        id="global-search"
        type="search"
        className="input search-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {(value || hasFilters) && (
        <button
          type="button"
          className="btn btn-quiet btn-sm icon-btn search-clear"
          onClick={onClear}
          aria-label="Clear all filters"
          title="Clear all filters"
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
};

export default SearchBar;
