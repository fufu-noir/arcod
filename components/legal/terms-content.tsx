export function TermsContent() {
    return (
        <div className="space-y-6 text-muted-foreground">
            <section>
                <h2 className="mb-2 text-lg font-semibold text-foreground">1. Intended Use</h2>
                <p>
                    This website is provided as a tool for users who legally own the rights to the music they download.
                    You may only use this service if you have the legal right to access and download the content in
                    question, such as music you have purchased or content you otherwise have the right to use.
                </p>
            </section>

            <section>
                <h2 className="mb-2 text-lg font-semibold text-foreground">2. Educational &amp; Research Purposes</h2>
                <p>
                    This platform may also be used for educational and research purposes, including studying audio
                    formats, compression technologies, metadata handling, and music streaming infrastructure. If you use
                    the service for research or learning, you remain responsible for complying with applicable laws and
                    regulations.
                </p>
            </section>

            <section>
                <h2 className="mb-2 text-lg font-semibold text-foreground">3. Disclaimer of Liability</h2>
                <p>
                    The administrator(s) and developer(s) of this website are{' '}
                    <strong className="text-foreground">not responsible</strong> for any misuse of this service. This
                    includes, but is not limited to, downloading music or other content without the necessary rights,
                    permissions, or licenses.
                </p>
                <p className="mt-2">By using this website, you acknowledge and agree that:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                    <li>You are solely responsible for ensuring you have the legal right to download any content.</li>
                    <li>The website administrators bear no liability for copyright infringement or other illegal activity conducted by users.</li>
                    <li>Any legal consequences arising from misuse of this service are the sole responsibility of the user.</li>
                </ul>
            </section>

            <section>
                <h2 className="mb-2 text-lg font-semibold text-foreground">4. No Warranty</h2>
                <p>
                    This service is provided &quot;as is&quot; without warranties of any kind, express or implied. The
                    administrators make no guarantees regarding availability, reliability, security, or fitness for a
                    particular purpose.
                </p>
            </section>

            <section>
                <h2 className="mb-2 text-lg font-semibold text-foreground">5. Acceptance of Terms</h2>
                <p>
                    By accessing or using this website, you confirm that you have read, understood, and agree to be
                    bound by these terms. If you do not agree with any part of these terms, you must not use the
                    service.
                </p>
            </section>

            <div className="border-t pt-4 text-sm text-muted-foreground/70">
                <p>Last updated: March 22, 2026</p>
            </div>
        </div>
    );
}
