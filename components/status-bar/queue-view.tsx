import React, { useState } from 'react';
import type { QueueProps } from './status-bar';
import { Button } from '../ui/button';
import { X, List as QueueIcon, ActivityIcon, DotIcon, Trash2 } from 'lucide-react';
import { Input } from '../ui/input';
import { useStatusBar } from '@/lib/status-bar/context';
import { ScrollArea } from '../ui/scroll-area';
import { Progress } from '../ui/progress';
import { clearQueue } from '@/lib/status-bar/jobs';


const QueueView = ({ queueItems }: { queueItems: QueueProps[] }) => {
    const { statusBar, setStatusBar } = useStatusBar();
    const [search, setSearch] = useState<string>('');

    const filteredItems = queueItems.filter((item) => item.title.toLowerCase().includes(search.toLowerCase()));

    return (
        <div className='flex flex-col gap-4 max-h-[70vh]'>
            <div className='sticky top-0 z-10 bg-background/50 backdrop-blur-md pb-2 flex gap-2'>
                <Input
                    placeholder='Filter queue...'
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className='flex-1 rounded-xl border-primary/10 bg-primary/5 focus-visible:ring-primary/20 transition-all'
                />
                {queueItems.length > 0 && (
                    <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => clearQueue(setStatusBar)}
                        className='shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive'
                    >
                        <Trash2 className='size-4 mr-1' />
                        Clear
                    </Button>
                )}
            </div>

            <ScrollArea className='flex-1 pr-4 -mr-4'>
                <div className='flex flex-col gap-2 pb-4'>
                    {statusBar.processing && (
                        <div className='p-4 rounded-2xl bg-primary/10 border border-primary/20 shadow-sm transition-all group'>
                            <div className='flex items-center justify-between gap-3 mb-3'>
                                <div className='flex items-center gap-3 min-w-0'>
                                    <div className='size-10 rounded-xl bg-primary/20 flex items-center justify-center shrink-0'>
                                        <ActivityIcon className='size-5 text-primary animate-pulse' />
                                    </div>
                                    <div className='min-w-0'>
                                        <p className='text-sm font-semibold truncate text-foreground'>
                                            {statusBar.title}
                                        </p>
                                        <p className='text-xs text-muted-foreground'>Currently Processing</p>
                                    </div>
                                </div>
                                <Button
                                    size='icon'
                                    variant='ghost'
                                    className='size-8 rounded-lg hover:bg-destructive/10 hover:text-destructive'
                                    onClick={statusBar.onCancel}
                                >
                                    <X className='size-4' />
                                </Button>
                            </div>
                            <Progress value={statusBar.progress} className='h-1.5' />
                        </div>
                    )}

                    {filteredItems.map((item, index) => (
                        <div
                            key={`${item.UUID}-${index}`}
                            className='flex items-center justify-between p-3 rounded-xl bg-card/40 border border-border/40 hover:border-primary/20 transition-all group'
                        >
                            <div className='flex items-center gap-3 min-w-0'>
                                <div className='size-8 rounded-lg bg-muted/50 flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors relative'>
                                    {item.icon ? (
                                        <item.icon className='size-4 text-muted-foreground group-hover:text-primary transition-colors' />
                                    ) : (
                                        <DotIcon className='size-4 text-muted-foreground' />
                                    )}
                                    {/* Queue position badge */}
                                    <span className='absolute -top-1.5 -right-1.5 bg-muted text-muted-foreground text-[9px] font-bold px-1 rounded-full min-w-[14px] text-center'>
                                        {index + 1}
                                    </span>
                                </div>
                                <p className='text-sm font-medium truncate text-foreground/80 group-hover:text-foreground transition-colors'>
                                    {item.title}
                                </p>
                            </div>
                            <Button
                                onClick={() => {
                                    if (item.remove) item.remove();
                                    setStatusBar(prev => ({
                                        ...prev,
                                        queue: prev.queue?.filter(q => q.UUID !== item.UUID)
                                    }));
                                }}
                                size='icon'
                                variant='ghost'
                                className='size-8 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive'
                            >
                                <X className='size-4' />
                            </Button>
                        </div>
                    ))}

                    {filteredItems.length === 0 && !statusBar.processing && (
                        <div className='mt-8 flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-muted rounded-3xl'>
                            <div className='size-12 rounded-full bg-muted/20 flex items-center justify-center mb-3'>
                                <QueueIcon className='size-6 text-muted-foreground/50' />
                            </div>
                            <h3 className='text-sm font-medium text-muted-foreground'>No items in queue</h3>
                            <p className='text-xs text-muted-foreground/60 mt-1'>Add some tracks to get started</p>
                        </div>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
};

export default QueueView;

