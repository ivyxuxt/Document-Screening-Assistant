'use client';

import { useState, useCallback } from 'react';
import type { Provider, JobStatusResponse } from '@shared/types';
import { PROVIDER_ENV_KEY } from '@shared/constants';
import UploadDropzone from './components/UploadDropzone';
import JudgeSelector, { type JudgeEntry } from './components/JudgeSelector';
import ApiKeyModal from './components/ApiKeyModal';
import ProgressPanel from './components/ProgressPanel';
import ResultDownload from './components/ResultDownload';
import RubricFormatInfo from './components/RubricFormatInfo';
import { submitJob } from './lib/apiClient';
import { Button } from './components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from './components/ui/card';
import { Textarea } from './components/ui/textarea';
import { Label } from './components/ui/label';

type Phase = 'form' | 'key-modal' | 'submitting' | 'polling' | 'done';

export default function Home() {
  const [phase, setPhase] = useState<Phase>('form');
  const [resumesZip, setResumesZip] = useState<File | null>(null);
  const [rubricXlsx, setRubricXlsx] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [judges, setJudges] = useState<JudgeEntry[]>([
    { id: crypto.randomUUID(), provider: 'openai', model: '' },
  ]);
  const [requiredKeys, setRequiredKeys] = useState<string[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobAccessToken, setJobAccessToken] = useState<string | null>(null);
  const [pollResult, setPollResult] = useState<JobStatusResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function getRequiredKeys(): string[] {
    const providers = [...new Set(judges.map(j => j.provider))] as Provider[];
    return providers.map(p => PROVIDER_ENV_KEY[p]);
  }

  function handleStart() {
    setSubmitError(null);
    if (!resumesZip) { setSubmitError('Please upload a resumes ZIP file.'); return; }
    if (!rubricXlsx) { setSubmitError('Please upload a rubric XLSX file.'); return; }
    if (judges.some(j => !j.model.trim())) { setSubmitError('Please enter a model name for each judge.'); return; }
    setRequiredKeys(getRequiredKeys());
    setPhase('key-modal');
  }

  async function handleKeysConfirmed(keys: Record<string, string>) {
    setPhase('submitting');
    setSubmitError(null);
    try {
      const result = await submitJob({
        resumesZip: resumesZip!,
        rubricXlsx: rubricXlsx!,
        notes: notes || undefined,
        judges: judges.map(({ provider, model }) => ({ provider, model })),
        apiKeys: keys,
      });
      setJobId(result.jobId);
      setJobAccessToken(result.accessToken);
      setPhase('polling');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Submission failed.';
      setSubmitError(msg);
      const errKeys = (err as { requiredKeys?: string[] }).requiredKeys;
      if (errKeys?.length) {
        setRequiredKeys(errKeys);
        setPhase('key-modal');
      } else {
        setPhase('form');
      }
    }
  }

  const handlePollResult = useCallback((result: JobStatusResponse) => {
    setPollResult(result);
    if (result.status === 'succeeded' || result.status === 'failed') {
      setPhase('done');
    }
  }, []);

  function handleReset() {
    setPhase('form');
    setResumesZip(null);
    setRubricXlsx(null);
    setNotes('');
    setJudges([{ id: crypto.randomUUID(), provider: 'openai', model: '' }]);
    setRequiredKeys([]);
    setJobId(null);
    setJobAccessToken(null);
    setPollResult(null);
    setSubmitError(null);
  }

  const isForm = phase === 'form';
  const disabled = !isForm;

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="mb-10 pl-4 border-l-4 border-plum">
        <h1 className="text-3xl font-bold text-ink tracking-tight">
          Document Screening Assistant
        </h1>
        <p className="mt-1.5 text-mauve text-base">
          Score resumes against a rubric using AI judges
        </p>
      </div>

      {/* Section 1: Upload Files */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>1. Upload Files</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="space-y-2">
              <Label>Resumes (ZIP)</Label>
              <UploadDropzone
                accept=".zip"
                label="Drag & drop a ZIP containing .pdf and .txt files"
                value={resumesZip}
                onChange={setResumesZip}
                disabled={disabled}
              />
            </div>
            <div className="space-y-2">
              <Label className="inline-flex items-center gap-1.5">
                Rubric (XLSX)
                <RubricFormatInfo />
              </Label>
              <UploadDropzone
                accept=".xlsx"
                label="Drag & drop an XLSX or click to browse"
                value={rubricXlsx}
                onChange={setRubricXlsx}
                disabled={disabled}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">
              Additional Notes{' '}
              <span className="text-mauve font-normal">(optional)</span>
            </Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              disabled={disabled}
              rows={3}
              placeholder="Any context about the role, requirements, or scoring preferences..."
            />
          </div>
        </CardContent>
      </Card>

      {/* Section 2: Configure Judges */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>2. Configure Judges</CardTitle>
        </CardHeader>
        <CardContent>
          <JudgeSelector judges={judges} onChange={setJudges} disabled={disabled} />
        </CardContent>
      </Card>

      {/* Error alert */}
      {submitError && (
        <div className="mb-5 px-4 py-3 rounded-xl border border-rose bg-rose/10 text-red-700 text-sm">
          {submitError}
        </div>
      )}

      {/* Actions */}
      {isForm && (
        <Button onClick={handleStart} size="lg" className="w-full mb-3">
          Start Screening →
        </Button>
      )}

      {phase === 'submitting' && (
        <div className="py-4 text-center text-mauve text-sm">Submitting job…</div>
      )}

      {/* Section 3: Progress */}
      {(phase === 'polling' || phase === 'done') && jobId && jobAccessToken && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>3. Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <ProgressPanel
              jobId={jobId}
              accessToken={jobAccessToken}
              onResult={handlePollResult}
              latestResult={pollResult}
            />
          </CardContent>
        </Card>
      )}

      {/* Section 4: Results */}
      {phase === 'done' && pollResult?.status === 'succeeded' && jobId && jobAccessToken && (
        <Card className="mb-6 border-rose">
          <CardHeader>
            <CardTitle>4. Results</CardTitle>
          </CardHeader>
          <CardContent>
            <ResultDownload jobId={jobId} accessToken={jobAccessToken} />
          </CardContent>
        </Card>
      )}

      {/* Reset */}
      {phase !== 'form' && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={handleReset}>Reset</Button>
        </div>
      )}

      {/* API Key Modal */}
      {phase === 'key-modal' && (
        <ApiKeyModal
          requiredKeys={requiredKeys}
          onConfirm={handleKeysConfirmed}
          onCancel={() => setPhase('form')}
        />
      )}
    </main>
  );
}
