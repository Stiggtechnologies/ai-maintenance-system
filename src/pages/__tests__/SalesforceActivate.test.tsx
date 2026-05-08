/**
 * SalesforceActivate tests
 * ========================
 * Salesforce activation is render-only (no token resolve happens on
 * landing — the LMA Flow drives lifecycle async). Covers URL param
 * extraction + the 3-step setup UI + Continue button wiring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../components/AuthShell', () => ({
  AuthShell: ({ children }: { children: React.ReactNode }) => <div data-testid="auth-shell">{children}</div>,
}));

import { SalesforceActivate } from '../SalesforceActivate';

function setUrl(url: string) {
  window.history.pushState({}, '', url);
}

describe('SalesforceActivate', () => {
  beforeEach(() => {
    setUrl('/marketplace/salesforce/activate');
  });

  it('renders the welcome heading and three setup steps', () => {
    render(<SalesforceActivate onContinueToSignup={vi.fn()} />);
    expect(screen.getByText(/Welcome from Salesforce AppExchange/)).toBeInTheDocument();
    expect(screen.getByText('Configure object permissions')).toBeInTheDocument();
    expect(screen.getByText('Activate the LMA license flow')).toBeInTheDocument();
    expect(screen.getByText('Connect your Anthropic key')).toBeInTheDocument();
  });

  it('renders the org details when ?organization_id and ?package_version_id are present', () => {
    setUrl('/marketplace/salesforce/activate?organization_id=00D000000abcXYZ&package_version_id=04t00000000Pvr3');
    render(<SalesforceActivate onContinueToSignup={vi.fn()} />);
    expect(screen.getByText('00D000000abcXYZ')).toBeInTheDocument();
    expect(screen.getByText('04t00000000Pvr3')).toBeInTheDocument();
  });

  it('also accepts the shorter ?orgId / ?pkg aliases', () => {
    setUrl('/marketplace/salesforce/activate?orgId=00D000000abcXYZ&pkg=04t00000000Pvr3');
    render(<SalesforceActivate onContinueToSignup={vi.fn()} />);
    expect(screen.getByText('00D000000abcXYZ')).toBeInTheDocument();
  });

  it('omits the org details panel when no params provided', () => {
    render(<SalesforceActivate onContinueToSignup={vi.fn()} />);
    expect(screen.queryByText(/Salesforce Org/)).not.toBeInTheDocument();
  });

  it('calls onContinueToSignup when the Continue button is clicked', async () => {
    const onContinue = vi.fn();
    const user = userEvent.setup();
    render(<SalesforceActivate onContinueToSignup={onContinue} />);
    await user.click(screen.getByTestId('sf-continue'));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
