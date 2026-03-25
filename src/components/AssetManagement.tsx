import { useState } from 'react';
import { Upload } from 'lucide-react';
import { CSVImportWizard } from './CSVImportWizard';

export function AssetManagement() {
  const [showImportWizard, setShowImportWizard] = useState(false);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Asset Management</h1>
        <button
          onClick={() => setShowImportWizard(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Upload className="w-4 h-4" />
          Import Assets (CSV)
        </button>
      </div>

      <div className="bg-white rounded-lg shadow p-8 text-center">
        <p className="text-gray-600 mb-4">Asset listing and management features coming soon...</p>
        <p className="text-sm text-gray-500">Use the Import Assets button above to bulk import assets from CSV.</p>
      </div>

      {showImportWizard && (
        <CSVImportWizard onClose={() => setShowImportWizard(false)} onComplete={() => setShowImportWizard(false)} />
      )}
    </div>
  );
}
