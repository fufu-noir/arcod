import { StatusBarProps } from '@/components/status-bar/status-bar';
import { LucideIcon } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

interface JobEntry {
    ready: () => Promise<void>;
    UUID: string;
    title: string;
    icon: LucideIcon;
    addedAt: number;
}

let jobs: JobEntry[] = [];
let isProcessing = false;
let currentJobUUID: string | null = null;

// Delay between jobs to prevent race conditions with network requests
const INTER_JOB_DELAY_MS = 500;

export function loadStatusBarValue(setStatusBar: React.Dispatch<React.SetStateAction<StatusBarProps>>): Promise<StatusBarProps> {
    return new Promise((resolve) => {
        setStatusBar((prev) => (resolve(prev), prev));
    });
}

export function getCurrentJobUUID(): string | null {
    return currentJobUUID;
}

export function getQueueLength(): number {
    return jobs.length;
}

export function isQueueProcessing(): boolean {
    return isProcessing;
}

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function processQueue(setStatusBar: React.Dispatch<React.SetStateAction<StatusBarProps>>) {
    if (isProcessing || jobs.length === 0) return;

    isProcessing = true;

    try {
        while (jobs.length > 0) {
            const currentJob = jobs[0];
            currentJobUUID = currentJob.UUID;

            // Update UI for the starting job
            setStatusBar((prev) => ({
                ...prev,
                processing: true,
                title: currentJob.title,
                progress: 0,
                open: prev.openPreference,
                queue: prev.queue?.filter(q => q.UUID !== currentJob.UUID) || []
            }));

            try {
                // Execute the job in isolation
                await currentJob.ready();
                window.dispatchEvent(new CustomEvent('job-completed', { detail: { uuid: currentJob.UUID } }));
            } catch (error) {
                console.error(`Job ${currentJob.UUID} failed:`, error);
                window.dispatchEvent(new CustomEvent('job-failed', { detail: { uuid: currentJob.UUID, error } }));
            }

            // Always remove the job whether it succeeded or failed
            jobs.shift();
            currentJobUUID = null;

            // Wait between jobs to ensure clean state
            // This prevents AbortController signals from leaking between jobs
            if (jobs.length > 0) {
                setStatusBar((prev) => ({
                    ...prev,
                    description: 'Preparing next download...',
                    progress: 0
                }));
                await sleep(INTER_JOB_DELAY_MS);
            }
        }
    } finally {
        // Guaranteed reset — protects against any unexpected crash in the loop
        // that would otherwise leave isProcessing=true and deadlock the queue forever
        isProcessing = false;
        currentJobUUID = null;
        setStatusBar((prev) => ({
            ...prev,
            processing: false,
            title: '',
            description: '',
            progress: 0,
            open: false
        }));
    }
}

export async function createJob(
    setStatusBar: React.Dispatch<React.SetStateAction<StatusBarProps>>,
    QueueTitle: string,
    QueueIcon: LucideIcon,
    ready: () => Promise<void>
) {
    const UUID = uuidv4();
    const newJob: JobEntry = {
        ready,
        UUID,
        title: QueueTitle,
        icon: QueueIcon,
        addedAt: Date.now()
    };

    // Use the synchronous module-level flag to avoid any async race condition.
    // (The old loadStatusBarValue approach was async and could cause two concurrent
    // createJob calls to both see isProcessing=false and both start processQueue.)
    if (isProcessing) {
        jobs.push(newJob);
        setStatusBar((prev) => ({
            ...prev,
            queue: [
                ...(prev.queue || []),
                {
                    title: QueueTitle,
                    UUID: UUID,
                    icon: QueueIcon,
                    remove: () => {
                        jobs = jobs.filter((item) => item.UUID !== UUID);
                        setStatusBar(p => ({
                            ...p,
                            queue: p.queue?.filter(q => q.UUID !== UUID)
                        }));
                    }
                }
            ]
        }));
    } else {
        // Start immediately
        jobs.push(newJob);
        processQueue(setStatusBar);
    }
}

// Clear all pending jobs (doesn't affect current job)
export function clearQueue(setStatusBar: React.Dispatch<React.SetStateAction<StatusBarProps>>) {
    jobs = [];
    setStatusBar((prev) => ({
        ...prev,
        queue: []
    }));
}
