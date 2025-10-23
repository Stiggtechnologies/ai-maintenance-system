import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { FileText, Download, ExternalLink } from 'lucide-react';

interface Invoice {
  id: string;
  period_start: string;
  period_end: string;
  total_cad: number;
  status: string;
  stripe_hosted_url?: string;
  created_at: string;
  base_amount_cad: number;
  asset_uplift_cad: number;
  usage_overage_cad: number;
}

export function InvoiceList() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchInvoices();
  }, []);

  const fetchInvoices = async () => {
    try {
      const { data: subscriptions } = await supabase
        .from('billing_subscriptions')
        .select('id')
        .eq('status', 'active')
        .limit(1);

      if (!subscriptions || subscriptions.length === 0) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('billing_invoices')
        .select('*')
        .eq('subscription_id', subscriptions[0].id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setInvoices(data || []);
    } catch (error) {
      console.error('Error fetching invoices:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'bg-green-100 text-green-700 border-green-200';
      case 'open':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'draft':
        return 'bg-gray-100 text-gray-700 border-gray-200';
      case 'void':
        return 'bg-red-100 text-red-700 border-red-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <div className="max-w-7xl mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Invoices</h1>
          <p className="text-gray-600">View and download your billing invoices</p>
        </div>

        {invoices.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">No Invoices Yet</h2>
            <p className="text-gray-600">Your invoices will appear here once generated</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Invoice Period
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">
                        {new Date(invoice.period_start).toLocaleDateString()} -{' '}
                        {new Date(invoice.period_end).toLocaleDateString()}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Base: ${invoice.base_amount_cad.toFixed(2)} |
                        Assets: ${invoice.asset_uplift_cad.toFixed(2)} |
                        Usage: ${invoice.usage_overage_cad.toFixed(2)}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {new Date(invoice.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-lg font-semibold text-gray-900">
                        ${invoice.total_cad.toFixed(2)}
                      </div>
                      <div className="text-xs text-gray-500">CAD</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(invoice.status)}`}>
                        {invoice.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {invoice.stripe_hosted_url && (
                          <a
                            href={invoice.stripe_hosted_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-teal-600 hover:text-teal-700 flex items-center gap-1 text-sm"
                          >
                            <ExternalLink className="w-4 h-4" />
                            View
                          </a>
                        )}
                        <button className="text-gray-600 hover:text-gray-700 flex items-center gap-1 text-sm">
                          <Download className="w-4 h-4" />
                          PDF
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
