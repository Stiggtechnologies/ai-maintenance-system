import { useState, useEffect } from 'react';
import { Play, Pause, SkipForward, SkipBack, Download } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface TraceSnapshot {
  id: string;
  run_id: string;
  trace_data: any;
  tool_calls: any[];
  costs: any[];
  created_at: string;
}

interface TraceReplayViewerProps {
  runId?: string;
  snapshotId?: string;
}

export function TraceReplayViewer({ runId, snapshotId }: TraceReplayViewerProps) {
  const [snapshot, setSnapshot] = useState<TraceSnapshot | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1000);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSnapshot();
  }, [runId, snapshotId]);

  useEffect(() => {
    if (isPlaying && snapshot) {
      const interval = setInterval(() => {
        setCurrentStep((prev) => {
          if (prev >= snapshot.tool_calls.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, playbackSpeed);
      return () => clearInterval(interval);
    }
  }, [isPlaying, playbackSpeed, snapshot]);

  const loadSnapshot = async () => {
    try {
      setLoading(true);
      if (snapshotId) {
        const { data, error } = await supabase
          .from('trace_snapshots')
          .select('*')
          .eq('id', snapshotId)
          .single();

        if (error) throw error;
        setSnapshot(data);
      } else if (runId) {
        const user = await supabase.auth.getUser();
        const { data: functionData, error: functionError } = await supabase.functions.invoke(
          'gateway',
          {
            body: { action: 'create_snapshot', run_id: runId, user_id: user.data.user?.id },
            method: 'POST',
          }
        );

        if (functionError) throw functionError;

        const { data, error } = await supabase
          .from('trace_snapshots')
          .select('*')
          .eq('id', functionData.snapshot_id)
          .single();

        if (error) throw error;
        setSnapshot(data);
      }
    } catch (error) {
      console.error('Error loading trace snapshot:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  const handleStepForward = () => {
    if (snapshot && currentStep < snapshot.tool_calls.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleStepBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleReset = () => {
    setCurrentStep(0);
    setIsPlaying(false);
  };

  const exportTrace = () => {
    if (!snapshot) return;
    const dataStr = JSON.stringify(snapshot, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `trace-${snapshot.run_id}.json`;
    link.click();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-500">No trace data available</p>
      </div>
    );
  }

  const currentToolCall = snapshot.tool_calls[currentStep];
  const totalCost = snapshot.costs.reduce((sum, cost) => sum + (cost.total_cost || 0), 0);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Trace Replay</h2>
            <p className="text-sm text-gray-500 mt-1">Run ID: {snapshot.run_id}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportTrace}
              className="flex items-center gap-2 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
          </div>
        </div>

        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 mb-6">
          <div className="grid grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-gray-600">Status</p>
              <p className="text-lg font-semibold text-gray-900">
                {snapshot.trace_data.status}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Tool Calls</p>
              <p className="text-lg font-semibold text-gray-900">
                {snapshot.tool_calls.length}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Total Cost</p>
              <p className="text-lg font-semibold text-gray-900">
                ${totalCost.toFixed(4)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Duration</p>
              <p className="text-lg font-semibold text-gray-900">
                {snapshot.trace_data.total_duration_ms || 0}ms
              </p>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-4">
              <button
                onClick={handleReset}
                className="p-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                title="Reset"
              >
                <SkipBack className="w-5 h-5" />
              </button>
              <button
                onClick={handleStepBack}
                disabled={currentStep === 0}
                className="p-2 text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                title="Previous Step"
              >
                <SkipBack className="w-5 h-5" />
              </button>
              <button
                onClick={handlePlayPause}
                className="p-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              </button>
              <button
                onClick={handleStepForward}
                disabled={currentStep >= snapshot.tool_calls.length - 1}
                className="p-2 text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                title="Next Step"
              >
                <SkipForward className="w-5 h-5" />
              </button>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-600">Speed:</label>
              <select
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                className="px-3 py-1 border border-gray-300 rounded-lg text-sm"
              >
                <option value={2000}>0.5x</option>
                <option value={1000}>1x</option>
                <option value={500}>2x</option>
                <option value={250}>4x</option>
              </select>
            </div>
          </div>

          <div className="relative">
            <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{
                  width: `${((currentStep + 1) / snapshot.tool_calls.length) * 100}%`,
                }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>Step {currentStep + 1} of {snapshot.tool_calls.length}</span>
              <span>{((currentStep + 1) / snapshot.tool_calls.length * 100).toFixed(0)}%</span>
            </div>
          </div>
        </div>

        {currentToolCall && (
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${
                  currentToolCall.status === 'success' ? 'bg-green-500' :
                  currentToolCall.status === 'error' ? 'bg-red-500' :
                  'bg-yellow-500'
                }`} />
                <div>
                  <h3 className="font-semibold text-gray-900">{currentToolCall.tool_name}</h3>
                  <p className="text-sm text-gray-500">
                    {new Date(currentToolCall.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                currentToolCall.status === 'success' ? 'bg-green-100 text-green-800' :
                currentToolCall.status === 'error' ? 'bg-red-100 text-red-800' :
                'bg-yellow-100 text-yellow-800'
              }`}>
                {currentToolCall.status}
              </span>
            </div>

            {currentToolCall.input && (
              <div className="mb-3">
                <p className="text-sm font-medium text-gray-700 mb-1">Input:</p>
                <pre className="bg-white p-3 rounded border border-gray-200 text-xs overflow-x-auto">
                  {JSON.stringify(currentToolCall.input, null, 2)}
                </pre>
              </div>
            )}

            {currentToolCall.output && (
              <div className="mb-3">
                <p className="text-sm font-medium text-gray-700 mb-1">Output:</p>
                <pre className="bg-white p-3 rounded border border-gray-200 text-xs overflow-x-auto max-h-64 overflow-y-auto">
                  {JSON.stringify(currentToolCall.output, null, 2)}
                </pre>
              </div>
            )}

            {currentToolCall.error && (
              <div className="bg-red-50 border border-red-200 rounded p-3">
                <p className="text-sm font-medium text-red-800 mb-1">Error:</p>
                <p className="text-sm text-red-700">{currentToolCall.error}</p>
              </div>
            )}

            <div className="flex items-center gap-4 text-xs text-gray-500 mt-3 pt-3 border-t border-gray-200">
              <span>Duration: {currentToolCall.duration_ms || 0}ms</span>
              {currentToolCall.cost && (
                <span>Cost: ${currentToolCall.cost.toFixed(4)}</span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Execution Timeline</h3>
        <div className="space-y-2">
          {snapshot.tool_calls.map((call, index) => (
            <button
              key={call.id}
              onClick={() => setCurrentStep(index)}
              className={`w-full text-left p-3 rounded-lg transition-colors ${
                index === currentStep
                  ? 'bg-blue-50 border-2 border-blue-500'
                  : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-500">#{index + 1}</span>
                  <span className="font-medium text-gray-900">{call.tool_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    call.status === 'success' ? 'bg-green-500' :
                    call.status === 'error' ? 'bg-red-500' :
                    'bg-yellow-500'
                  }`} />
                  <span className="text-xs text-gray-500">{call.duration_ms || 0}ms</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
