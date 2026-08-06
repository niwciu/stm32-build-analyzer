export interface SingleViewRenderPlan<T extends string> {
  render: T;
  clear: T[];
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
