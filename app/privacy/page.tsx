'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { PrivacyPolicyContent } from '@/components/legal/privacy-policy-content';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function PrivacyPage() {
    return (
        <div className='w-full max-w-3xl mx-auto'>
            <div className='mb-4 flex flex-wrap gap-2'>
                <Link href='/'>
                    <Button variant='ghost'>
                        <ArrowLeft className='mr-2 h-4 w-4' />
                        Back to Home
                    </Button>
                </Link>
                <Link href='/terms'>
                    <Button variant='outline'>Terms of Use</Button>
                </Link>
            </div>

            <Card className='bg-background/80 backdrop-blur-sm'>
                <CardHeader>
                    <CardTitle className='text-2xl'>Privacy Policy</CardTitle>
                </CardHeader>
                <CardContent>
                    <PrivacyPolicyContent />
                </CardContent>
            </Card>
        </div>
    );
}
