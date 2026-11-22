import { FieldValidationError, type ValidationIssue } from './issues'

export class SettingsValidationError extends FieldValidationError {
  constructor(issues: readonly ValidationIssue[]) {
    super('setting', issues)
    this.name = 'SettingsValidationError'
  }
}
