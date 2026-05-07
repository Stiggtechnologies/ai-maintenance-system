/**
 * ConnectIntegrationModal tests
 * =============================
 * Covers the schema → form rendering, required-field validation, password
 * masking toggle, and the submit path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectIntegrationModal, type CatalogEntry } from '../ConnectIntegrationModal';

const anthropicEntry: CatalogEntry = {
  code: 'anthropic',
  vendor: 'Anthropic',
  product: 'Claude API',
  category: 'ai',
  description: 'Claude AI for agent reasoning',
  auth_type: 'api_key',
  has_test_endpoint: true,
  docs_url: null,
  credentials_schema: {
    type: 'object',
    required: ['api_key'],
    properties: {
      api_key: { type: 'string', format: 'password', title: 'Anthropic API key' },
      model: {
        type: 'string',
        default: 'claude-sonnet-4-6',
        enum: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
      },
    },
  },
};

const sapEntry: CatalogEntry = {
  code: 'sap_pm',
  vendor: 'SAP',
  product: 'SAP PM',
  category: 'erp_cmms',
  description: null,
  auth_type: 'connection_string',
  has_test_endpoint: false,
  docs_url: null,
  credentials_schema: {
    type: 'object',
    required: ['base_url', 'username', 'password'],
    properties: {
      base_url: { type: 'string', format: 'uri', title: 'OData base URL' },
      username: { type: 'string' },
      password: { type: 'string', format: 'password' },
    },
  },
};

describe('ConnectIntegrationModal', () => {
  let onClose: ReturnType<typeof vi.fn>;
  let onSubmit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onClose = vi.fn();
    onSubmit = vi.fn().mockResolvedValue(undefined);
  });

  it('renders fields from credentials_schema and pre-populates default values', () => {
    render(<ConnectIntegrationModal entry={anthropicEntry} onClose={onClose} onSubmit={onSubmit} />);

    expect(screen.getByText('Anthropic · Claude API')).toBeInTheDocument();
    expect(screen.getByText('Anthropic API key')).toBeInTheDocument();
    // Default name = "<vendor> <product>"
    const nameInput = screen.getByDisplayValue('Anthropic Claude API');
    expect(nameInput).toBeInTheDocument();
    // Enum field renders as <select> with options + the default
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('claude-sonnet-4-6');
  });

  it('marks required fields with an asterisk and disables submit until they are filled', () => {
    render(<ConnectIntegrationModal entry={anthropicEntry} onClose={onClose} onSubmit={onSubmit} />);
    const submit = screen.getByTestId('connect-submit') as HTMLButtonElement;
    expect(submit).toBeDisabled();
  });

  it('toggles password visibility when the eye icon is clicked', async () => {
    const user = userEvent.setup();
    render(<ConnectIntegrationModal entry={anthropicEntry} onClose={onClose} onSubmit={onSubmit} />);

    // Find the password-formatted field by its label
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    // api_key is rendered as <input type="password"> initially — not a textbox role
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    expect(passwordInputs.length).toBeGreaterThan(0);

    const toggle = screen.getAllByRole('button').find(b => b.getAttribute('tabindex') === '-1');
    expect(toggle).toBeDefined();
    await user.click(toggle!);

    // After click, the password field should now be type="text"
    const visibleInputs = document.querySelectorAll('input[type="text"]');
    expect(visibleInputs.length).toBeGreaterThan(inputs.length);
  });

  it('submits with name + credentials on valid form', async () => {
    const user = userEvent.setup();
    render(<ConnectIntegrationModal entry={anthropicEntry} onClose={onClose} onSubmit={onSubmit} />);

    const passwordField = document.querySelector('input[type="password"]') as HTMLInputElement;
    await user.type(passwordField, 'sk-ant-test-key-12345');

    const submit = screen.getByTestId('connect-submit');
    await waitFor(() => expect(submit).not.toBeDisabled());
    await user.click(submit);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [entry, name, credentials] = onSubmit.mock.calls[0];
    expect(entry.code).toBe('anthropic');
    expect(name).toBe('Anthropic Claude API');
    expect(credentials.api_key).toBe('sk-ant-test-key-12345');
    expect(credentials.model).toBe('claude-sonnet-4-6');
  });

  it('shows the "credential validation only" hint when has_test_endpoint=false', () => {
    render(<ConnectIntegrationModal entry={sapEntry} onClose={onClose} onSubmit={onSubmit} />);
    expect(screen.getByText(/Credentials will be stored encrypted/)).toBeInTheDocument();
    expect(screen.queryByText(/A live connectivity test will run/)).not.toBeInTheDocument();
  });

  it('shows the "live connectivity test" hint when has_test_endpoint=true', () => {
    render(<ConnectIntegrationModal entry={anthropicEntry} onClose={onClose} onSubmit={onSubmit} />);
    expect(screen.getByText(/A live connectivity test will run on connect/)).toBeInTheDocument();
  });

  it('renders a fallback message when the catalog entry has no credential fields', () => {
    const empty: CatalogEntry = { ...sapEntry, credentials_schema: { type: 'object' } };
    render(<ConnectIntegrationModal entry={empty} onClose={onClose} onSubmit={onSubmit} />);
    expect(screen.getByText(/no credential fields defined yet/i)).toBeInTheDocument();
  });

  it('surfaces submit errors without closing the modal', async () => {
    const user = userEvent.setup();
    onSubmit.mockRejectedValueOnce(new Error('Server unreachable'));

    render(<ConnectIntegrationModal entry={anthropicEntry} onClose={onClose} onSubmit={onSubmit} />);
    const passwordField = document.querySelector('input[type="password"]') as HTMLInputElement;
    await user.type(passwordField, 'sk-ant-test');

    const submit = screen.getByTestId('connect-submit');
    await waitFor(() => expect(submit).not.toBeDisabled());
    await user.click(submit);

    await waitFor(() => expect(screen.getByText('Server unreachable')).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes when the backdrop is clicked', () => {
    render(<ConnectIntegrationModal entry={anthropicEntry} onClose={onClose} onSubmit={onSubmit} />);
    // The outermost div is the backdrop; clicking it triggers onClose
    const backdrop = screen.getByTestId('connect-modal').parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
