export function PrivacyPolicyContent() {
    return (
        <div className="space-y-6 text-muted-foreground">
            <section>
                <h2 className="mb-2 text-lg font-semibold text-foreground">1. Scope</h2>
                <p>
                    This Privacy Policy explains how arcod collects, uses, stores, and protects information when you
                    access the website, create an account, sign in, or use download-related features.
                </p>
            </section>

            <section>
                <h2 className="mb-2 text-lg font-semibold text-foreground">2. Data We May Collect</h2>
                <ul className="list-disc space-y-1 pl-5">
                    <li>Account data such as your email address and, when available, basic profile data returned by your authentication provider.</li>
                    <li>Technical and security data such as your IP address, user agent, timestamps, and request metadata used to operate and protect the service.</li>
                    <li>Service usage data related to your downloads and library, including album, track, format, status, storage, and activity history.</li>
                    <li>Browser-side preferences stored locally on your device, such as guest-session state, selected country, and application settings.</li>
                </ul>
            </section>

            <section>
                <h2 className="mb-2 text-lg font-semibold text-foreground">3. How We Use Your Data</h2>
                <ul className="list-disc space-y-1 pl-5">
                    <li>To authenticate users and keep accounts available.</li>
                    <li>To provide download, library, history, and storage-related features.</li>
                    <li>To prevent abuse, detect bots, apply rate limits, investigate suspicious activity, and protect infrastructure.</li>
                    <li>To monitor usage, maintain performance, and improve the service over time.</li>
                </ul>
            </section>

            <section>
                <h2 className="mb-2 text-lg font-semibold text-foreground">4. Third-Party Services</h2>
                <p>The service relies on third-party providers to operate certain functions, including:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                    <li>Supabase for authentication and session management.</li>
                    <li>S3-compatible object storage used to store generated download files.</li>
                </ul>
                <p className="mt-2">
                    These providers may process limited data as needed to deliver their respective services under their
                    own privacy and security terms.
                </p>
            </section>

            <section>
                <h2 className="mb-2 text-lg font-semibold text-foreground">5. Retention</h2>
                <p>
                    We keep information only for as long as reasonably necessary to operate the service, maintain
                    account and library features.
                </p>
            </section>

            <section>
                <h2 className="mb-2 text-lg font-semibold text-foreground">6. Sharing</h2>
                <p>
                    We do not sell/share your personal data.
                </p>
            </section>

            <section>
                <h2 className="mb-2 text-lg font-semibold text-foreground">7. Security</h2>
                <p>
                    We use reasonable technical and organizational measures to protect the service and its data.
                    However, no online service can guarantee absolute security, and you use the platform at your own
                    risk.
                </p>
            </section>

            <section>
                <h2 className="mb-2 text-lg font-semibold text-foreground">8. Your Choices</h2>
                <ul className="list-disc space-y-1 pl-5">
                    <li>You may choose not to create an account, but some features may be unavailable.</li>
                    <li>You can stop using the service at any time.</li>
                    <li>You can clear browser-stored preferences directly from your device.</li>
                    <li>If you need account-related assistance, you may contact the service operator through the available support channels.</li>
                </ul>
            </section>

            <section>
                <h2 className="mb-2 text-lg font-semibold text-foreground">9. Changes to This Policy</h2>
                <p>
                    This Privacy Policy may be updated from time to time. Continued use of the service after an update
                    means the revised policy applies from its published effective date.
                </p>
            </section>

            <div className="border-t pt-4 text-sm text-muted-foreground/70">
                <p>Last updated: March 22, 2026</p>
            </div>
        </div>
    );
}
