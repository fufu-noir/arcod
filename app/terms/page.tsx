'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TermsContent } from '@/components/legal/terms-content';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function TermsPage() {
    return (
        <div className='w-full max-w-3xl mx-auto'>
            <div className='mb-4 flex flex-wrap gap-2'>
                <Link href='/'>
                    <Button variant='ghost'>
                        <ArrowLeft className='mr-2 h-4 w-4' />
                        Back to Home
                    </Button>
                </Link>
                <Link href='/privacy'>
                    <Button variant='outline'>Privacy Policy</Button>
                </Link>
            </div>

            <Card className='bg-background/80 backdrop-blur-sm'>
                <CardHeader>
                    <CardTitle className='text-2xl'>Terms of Use & Disclaimer</CardTitle>
                </CardHeader>
                <CardContent>
                    <TermsContent />
                </CardContent>
            </Card>
        </div>
    );
}
