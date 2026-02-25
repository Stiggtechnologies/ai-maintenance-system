import { useState, useCallback } from 'react';
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Download, Loader2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthProvider';

interface ImportResult {
  success: number;
  failed: number;
  errors: string[];
}

export function CSVImportWizard({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const { user } = useAuth();
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [preview, setPreview] = useState<any[]>([]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = async (file: File) => {
    if (!file.name.endsWith('.csv')) {
      alert('Please upload a CSV file');
      return;
    }

    setFile(file);
    setParsing(true);

    try {
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      const headers = lines[0].split(',').map(h => h.trim());
      
      // Parse first 5 rows for preview
      const previewData = lines.slice(1, 6).map(line => {
        const values = line.split(',').map(v => v.trim());
        return headers.reduce((obj, header, index) => ({
          ...obj,
          [header]: values[index] || ''
        }), {});
      });

      setPreview(previewData);
    } catch (error) {
      console.error('Error parsing CSV:', error);
      alert('Error parsing CSV file');
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    if (!file || !user) return;

    setImporting(true);
    const errors: string[] = [];
    let successCount = 0;
    let failedCount = 0;

    try {
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        const row = headers.reduce((obj, header, index) => ({
          ...obj,
          [header]: values[index] || ''
        }), {} as any);

        // Validate required fields
        if (!row.name || !row.type) {
          errors.push(`Row ${i + 1}: Missing required fields (name, type)`);
          failedCount++;
          continue;
        }

        try {
          const { error } = await supabase
            .from('assets')
            .insert({
              tenant_id: user.id,
              name: row.name,
              type: row.type,
              location: row.location || null,
              criticality: row.criticality || 'medium',
              status: row.status || 'operational'
            });

          if (error) {
            errors.push(`Row ${i + 1}: ${error.message}`);
            failedCount++;
          } else {
            successCount++;
          }
        } catch (error) {
          errors.push(`Row ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          failedCount++;
        }
      }

      setResult({ success: successCount, failed: failedCount, errors });
    } catch (error) {
      console.error('Import error:', error);
      setResult({ success: 0, failed: 0, errors: ['Failed to process CSV file'] });
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const template = 'name,type,location,criticality,status\nPump P-101,Centrifugal Pump,Building A,high,operational\nMotor M-205,Electric Motor,Building B,medium,operational\nCompressor C-300,Air Compressor,Building A,critical,operational';
    const blob = new Blob([template], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'syncai-asset-template.csv';
    a.click();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-300">
        {/* Header */}
        <div className="bg-gradient-to-r from-teal-600 to-blue-600 p-6 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-2xl font-bold">Import Assets from CSV</h2>
                <p className="text-teal-100">Bulk upload your asset inventory</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 transition-colors flex items-center justify-center"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-8 overflow-y-auto max-h-[calc(90vh-120px)]">
          {!result ? (
            <>
              {/* Step 1: Download Template */}
              {!file && (
                <div className="mb-8">
                  <h3 className="font-semibold text-gray-900 mb-4">Step 1: Download Template</h3>
                  <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
                    <p className="text-gray-600 mb-4">
                      Start with our CSV template to ensure your data is formatted correctly.
                    </p>
                    <button
                      onClick={downloadTemplate}
                      className="flex items-center space-x-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download CSV Template</span>
                    </button>
                    <div className="mt-4 text-sm text-gray-600">
                      <p className="font-medium mb-2">Required columns:</p>
                      <ul className="list-disc list-inside space-y-1 text-gray-500">
                        <li><code className="bg-gray-200 px-1 py-0.5 rounded">name</code> - Asset name</li>
                        <li><code className="bg-gray-200 px-1 py-0.5 rounded">type</code> - Asset type (e.g., Pump, Motor)</li>
                        <li><code className="bg-gray-200 px-1 py-0.5 rounded">location</code> - Physical location (optional)</li>
                        <li><code className="bg-gray-200 px-1 py-0.5 rounded">criticality</code> - low, medium, high, critical (optional)</li>
                        <li><code className="bg-gray-200 px-1 py-0.5 rounded">status</code> - operational, maintenance, offline (optional)</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Upload File */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-4">
                  {file ? 'Step 3: Review & Import' : 'Step 2: Upload CSV File'}
                </h3>

                {!file ? (
                  <div
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-xl p-12 text-center transition-all ${
                      dragActive
                        ? 'border-teal-500 bg-teal-50'
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    <Upload className={`w-16 h-16 mx-auto mb-4 ${
                      dragActive ? 'text-teal-600' : 'text-gray-400'
                    }`} />
                    <p className="text-lg font-medium text-gray-900 mb-2">
                      {dragActive ? 'Drop your CSV file here' : 'Drag and drop your CSV file'}
                    </p>
                    <p className="text-sm text-gray-600 mb-4">or</p>
                    <label className="inline-flex items-center space-x-2 px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors cursor-pointer font-medium">
                      <Upload className="w-5 h-5" />
                      <span>Browse Files</span>
                      <input
                        type="file"
                        accept=".csv"
                        onChange={handleChange}
                        className="hidden"
                      />
                    </label>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* File Info */}
                    <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <FileSpreadsheet className="w-8 h-8 text-teal-600" />
                        <div>
                          <p className="font-medium text-gray-900">{file.name}</p>
                          <p className="text-sm text-gray-600">
                            {(file.size / 1024).toFixed(2)} KB • Ready to import
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => { setFile(null); setPreview([]); }}
                        className="text-gray-600 hover:text-gray-800"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Preview */}
                    {preview.length > 0 && (
                      <div>
                        <p className="text-sm font-medium text-gray-700 mb-3">
                          Preview (first 5 rows):
                        </p>
                        <div className="overflow-x-auto border border-gray-200 rounded-lg">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                {Object.keys(preview[0]).map((key) => (
                                  <th
                                    key={key}
                                    className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider"
                                  >
                                    {key}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {preview.map((row, idx) => (
                                <tr key={idx}>
                                  {Object.values(row).map((val: any, i) => (
                                    <td key={i} className="px-4 py-2 text-sm text-gray-900">
                                      {val}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Import Button */}
                    <div className="flex justify-end space-x-3">
                      <button
                        onClick={() => { setFile(null); setPreview([]); }}
                        className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleImport}
                        disabled={importing || parsing}
                        className="px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                      >
                        {importing ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            <span>Importing...</span>
                          </>
                        ) : (
                          <>
                            <Upload className="w-5 h-5" />
                            <span>Import Assets</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Results */
            <div className="space-y-6">
              <div className={`p-6 rounded-xl border-2 ${
                result.failed === 0
                  ? 'bg-green-50 border-green-200'
                  : 'bg-yellow-50 border-yellow-200'
              }`}>
                <div className="flex items-center space-x-3 mb-4">
                  {result.failed === 0 ? (
                    <CheckCircle2 className="w-8 h-8 text-green-600" />
                  ) : (
                    <AlertCircle className="w-8 h-8 text-yellow-600" />
                  )}
                  <div>
                    <h3 className={`text-xl font-bold ${
                      result.failed === 0 ? 'text-green-900' : 'text-yellow-900'
                    }`}>
                      Import {result.failed === 0 ? 'Complete!' : 'Completed with Errors'}
                    </h3>
                    <p className={`text-sm ${
                      result.failed === 0 ? 'text-green-700' : 'text-yellow-700'
                    }`}>
                      {result.success} assets imported successfully
                      {result.failed > 0 && `, ${result.failed} failed`}
                    </p>
                  </div>
                </div>

                {result.errors.length > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-medium text-yellow-900 mb-2">Errors:</p>
                    <div className="bg-white rounded-lg p-4 max-h-48 overflow-y-auto">
                      <ul className="space-y-1 text-sm text-yellow-800">
                        {result.errors.map((error, idx) => (
                          <li key={idx}>• {error}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setResult(null);
                    setFile(null);
                    setPreview([]);
                  }}
                  className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                >
                  Import More
                </button>
                <button
                  onClick={() => {
                    onComplete();
                    onClose();
                  }}
                  className="px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors font-medium"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
