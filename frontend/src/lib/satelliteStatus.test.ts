import { describe, it, expect } from 'vitest';
import {
  canManageStatus, statusModeOf, isManualOverride, effectiveStatus, derivedStatus,
  validateStatusForm, isStatusChange, describeStatusChange, toStatusRequest, MANUAL_STATUS_OPTIONS,
  type StatusFormState,
} from './satelliteStatus';
import type { Satellite } from '../types';

const sat = (over: Partial<Satellite> = {}): Satellite => ({
  id: 'ORION-3', name: 'ORION-3', norad_id: '1', mission: 'm', orbit_type: 'LEO',
  altitude: 0, velocity: 0, latitude: 0, longitude: 0, health_score: 0,
  status: 'HEALTHY', ...over,
});

describe('canManageStatus (RBAC)', () => {
  it('allows Director/Admin, denies Analyst/none', () => {
    expect(canManageStatus('MISSION_DIRECTOR')).toBe(true);
    expect(canManageStatus('SYSTEM_ADMIN')).toBe(true);
    expect(canManageStatus('MISSION_ANALYST')).toBe(false);
    expect(canManageStatus(null)).toBe(false);
  });
});

describe('mode + status resolution', () => {
  it('AUTO by default; effective falls back to status', () => {
    const s = sat();
    expect(statusModeOf(s)).toBe('AUTO');
    expect(isManualOverride(s)).toBe(false);
    expect(effectiveStatus(s)).toBe('HEALTHY');
    expect(derivedStatus(s)).toBe('HEALTHY');
  });
  it('MANUAL override exposes both derived and effective', () => {
    const s = sat({ status: 'WARNING', status_mode: 'MANUAL', manual_status: 'WARNING', derived_status: 'HEALTHY', effective_status: 'WARNING' });
    expect(isManualOverride(s)).toBe(true);
    expect(effectiveStatus(s)).toBe('WARNING');
    expect(derivedStatus(s)).toBe('HEALTHY');
  });
});

describe('validateStatusForm', () => {
  it('requires a status when MANUAL', () => {
    expect(validateStatusForm({ mode: 'MANUAL', status: '', reason: '' }).status).toBeTruthy();
    expect(validateStatusForm({ mode: 'MANUAL', status: 'ALERT', reason: '' })).toEqual({});
  });
  it('no status needed for AUTO', () => {
    expect(validateStatusForm({ mode: 'AUTO', status: '', reason: 'back to auto' })).toEqual({});
  });
  it('bounds the reason length', () => {
    expect(validateStatusForm({ mode: 'AUTO', status: '', reason: 'x'.repeat(501) }).reason).toBeTruthy();
  });
  it('only exposes the three canonical manual statuses', () => {
    expect(MANUAL_STATUS_OPTIONS).toEqual(['HEALTHY', 'WARNING', 'ALERT']);
  });
});

describe('isStatusChange', () => {
  it('detects AUTO→MANUAL and manual value changes, ignores no-ops', () => {
    const auto = sat({ status_mode: 'AUTO' });
    expect(isStatusChange(auto, { mode: 'MANUAL', status: 'WARNING', reason: '' })).toBe(true);
    expect(isStatusChange(auto, { mode: 'AUTO', status: '', reason: '' })).toBe(false);
    const man = sat({ status_mode: 'MANUAL', manual_status: 'WARNING' });
    expect(isStatusChange(man, { mode: 'MANUAL', status: 'ALERT', reason: '' })).toBe(true);
    expect(isStatusChange(man, { mode: 'MANUAL', status: 'WARNING', reason: '' })).toBe(false);
    expect(isStatusChange(man, { mode: 'AUTO', status: '', reason: '' })).toBe(true);
  });
});

describe('describeStatusChange', () => {
  it('phrases manual override and return-to-auto', () => {
    expect(describeStatusChange('ORION-3', 'HEALTHY', { mode: 'MANUAL', status: 'WARNING', reason: '' }))
      .toBe('Change ORION-3 effective status from HEALTHY to WARNING?');
    expect(describeStatusChange('ORION-3', 'WARNING', { mode: 'AUTO', status: '', reason: '' }))
      .toBe('Return ORION-3 to automatic status calculation?');
  });
});

describe('toStatusRequest', () => {
  it('omits empty status/reason', () => {
    expect(toStatusRequest({ mode: 'AUTO', status: '', reason: '  ' })).toEqual({ mode: 'AUTO' });
    expect(toStatusRequest({ mode: 'MANUAL', status: 'ALERT', reason: 'esc' })).toEqual({ mode: 'MANUAL', status: 'ALERT', reason: 'esc' });
  });
});

const _f: StatusFormState = { mode: 'AUTO', status: '', reason: '' };
void _f;
