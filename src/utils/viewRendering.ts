export interface SingleViewRenderPlan<T extends string> {
  render: T;
  clear: T[];
}

export interface StoredSortState {
  field: string | null;
  isAscending: boolean;
}

export interface SortDirective {
  field: string;
  isAscending: boolean;
}

export interface AnalysisFailureUiState {
  status: string;
  buildFolder: string;
  selectionToggle: string;
  searchMatchCount: string;
}

export function createSingleViewRenderPlan<T extends string>(
  views: readonly T[],
  activeView: T
): SingleViewRenderPlan<T> {
  return {
    render: activeView,
    clear: views.filter(view => view !== activeView),
  };
}

export function getStoredSortDirective(
  state: StoredSortState
): SortDirective | undefined {
  return state.field
    ? { field: state.field, isAscending: state.isAscending }
    : undefined;
}

export function createAnalysisFailureUiState(
  message?: string
): AnalysisFailureUiState {
  return {
    status: message || 'Build analysis failed.',
    buildFolder: 'Analysis unavailable',
    selectionToggle: 'Show Selected',
    searchMatchCount: '',
  };
}
