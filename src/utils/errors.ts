export class UserCancelledError extends Error {
  constructor(message = 'Operation cancelled by user') {
    super(message);
    this.name = 'UserCancelledError';
  }
}

export class AnalysisCancelledError extends Error {
  constructor(message = 'Analysis superseded by a newer refresh') {
    super(message);
    this.name = 'AnalysisCancelledError';
  }
}
