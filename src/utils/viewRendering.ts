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
