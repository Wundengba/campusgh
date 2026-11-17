import { useEffect, useRef, useState } from "react";
import "./LegalDocuments.css";

const LEGAL_DOCUMENTS = {
  terms: {
    label: "Terms of Use",
    sections: [
      {
        title: "1. About Campus Ghana",
        paragraphs: [
          "Campus Ghana provides educational resources and student portal features. Depending on your account and institution, these may include course materials, academic and school records, study teams, campus communities, social posts, and notifications.",
          "Your school or institution may decide which features and records are available to you. Its own policies may also apply to information it provides to the service.",
        ],
      },
      {
        title: "2. Accounts and access",
        paragraphs: [
          "Provide accurate account information and keep your sign-in details confidential. Student access may depend on an account or Student ID provisioned by a school administrator. Do not share an account or impersonate another person.",
          "If you are under 18, use the service with permission and appropriate guidance from a parent or guardian. Tell your school administrator if you believe your account has been accessed without permission.",
        ],
      },
      {
        title: "3. Acceptable use",
        paragraphs: [
          "Use Campus Ghana for lawful educational and community purposes. Do not harass, threaten, impersonate, spam, or expose another person's private information; upload unlawful, infringing, or harmful material; disrupt the service; or attempt to access accounts, records, or systems without authorization.",
        ],
      },
      {
        title: "4. Posts and other content",
        paragraphs: [
          "You remain responsible for content you submit. You give Campus Ghana permission to host, store, process, and display that content only as needed to operate, secure, and provide the features and audience settings you choose. Posts shared publicly or with a community may be visible to its members.",
          "Do not post passwords, Student IDs, contact details, private academic records, or other sensitive information in public or community spaces. Remove content you no longer want displayed and contact an administrator if you need help.",
        ],
      },
      {
        title: "5. Learning materials and school records",
        paragraphs: [
          "Learning resources are provided to support study; they do not guarantee examination results, admission, or other outcomes. Confirm important academic requirements with your school or the relevant examination authority.",
          "School records should be reviewed through the appropriate school process. Contact your institution to request a correction to information it manages.",
        ],
      },
      {
        title: "6. Safety and account action",
        paragraphs: [
          "Administrators may review reports and take reasonable steps to protect students and the service, including removing content or restricting accounts where necessary. We may update, suspend, or discontinue features for operational, safety, or legal reasons.",
        ],
      },
      {
        title: "7. Changes and contact",
        paragraphs: [
          "These terms may be updated as Campus Ghana changes. Continued use after an update means you have had an opportunity to review the revised terms. For questions or account concerns, contact the administrator at mrwundengba@gmail.com.",
        ],
      },
    ],
  },
  privacy: {
    label: "Privacy Notice",
    sections: [
      {
        title: "1. Information used by the service",
        paragraphs: [
          "Depending on your account and the features enabled by your institution, Campus Ghana may handle identity and contact details such as your name, display name, email address, phone number, date of birth, Student ID, school, education level, region, and profile photo.",
          "The service may also handle school records supplied by an institution, including enrollment, course, assessment, attendance, selection, or other student information.",
        ],
      },
      {
        title: "2. Content and activity",
        paragraphs: [
          "If you use Campus Social or Study Teams, the service processes the posts, photos or videos, comments, reactions, follows, group memberships, and messages you submit. It also records service activity needed for features such as notifications, moderation, and post-view counts.",
          "Campus Ghana may store sign-in/session information and settings you choose, such as display preferences. Avoid including sensitive personal information in public posts or shared groups.",
        ],
      },
      {
        title: "3. How information is used",
        paragraphs: [
          "Information is used to authenticate accounts; provide learning, school, and community features; display records to the appropriate user or authorized school personnel; send service-related notices; respond to support requests; and protect the service from misuse.",
        ],
      },
      {
        title: "4. When information is shared",
        paragraphs: [
          "Information may be available to the school or institution that manages your account and to its authorized personnel for school operations. Social content is shared according to the audience you select and the visibility of the relevant community.",
          "Campus Ghana relies on service providers to support functions such as hosting, authentication, file storage, and account or message delivery. Information may also be disclosed when required by law or needed to address security, safety, or service integrity concerns.",
        ],
      },
      {
        title: "5. Storage, security, and retention",
        paragraphs: [
          "Account and service information is stored using the systems configured for Campus Ghana. Reasonable safeguards are used to protect it, but no online service can guarantee absolute security.",
          "Information is retained as needed to operate the service, meet school or legal requirements, and address security or dispute concerns. Retention periods may depend on the institution that manages your records.",
        ],
      },
      {
        title: "6. Your choices and requests",
        paragraphs: [
          "Keep your profile information accurate and choose carefully where you post or share content. For requests to access, correct, or remove account information, contact your school administrator or the Campus Ghana administrator. Some school records must be corrected by the institution that supplied them.",
        ],
      },
      {
        title: "7. Students under 18",
        paragraphs: [
          "Campus Ghana supports learners who may be under 18. Parents or guardians should help younger students understand safe account use and avoid sharing personal or sensitive information in social features. Contact the administrator with questions about a student's information.",
        ],
      },
      {
        title: "8. Updates and contact",
        paragraphs: [
          "This notice may be updated when the service or its data practices change. Questions or privacy requests can be sent to mrwundengba@gmail.com.",
        ],
      },
    ],
  },
};

export function LegalDocuments({ placement = "footer" }) {
  const [activeDocument, setActiveDocument] = useState(null);
  const dialogRef = useRef(null);
  const document = activeDocument ? LEGAL_DOCUMENTS[activeDocument] : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!document || !dialog) return undefined;
    if (!dialog.open) dialog.showModal();

    const handleCancel = (event) => {
      event.preventDefault();
      dialog.close();
      setActiveDocument(null);
    };
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [document]);

  const closeDialog = () => {
    if (dialogRef.current?.open) dialogRef.current.close();
    setActiveDocument(null);
  };

  return (
    <div className={`legal-documents legal-documents-${placement}`}>
      {placement === "topbar" ? (
        <button
          className="topbar-legal-trigger"
          type="button"
          aria-haspopup="dialog"
          title="Terms and privacy"
          onClick={() => setActiveDocument("terms")}
        >
          Legal
        </button>
      ) : (
        <nav className="legal-document-links" aria-label="Legal information">
          <button type="button" onClick={() => setActiveDocument("terms")}>
            Terms of Use
          </button>
          <button type="button" onClick={() => setActiveDocument("privacy")}>
            Privacy Notice
          </button>
        </nav>
      )}

      <dialog
        className="legal-document-dialog"
        ref={dialogRef}
        aria-labelledby="legal-document-title"
        onClose={() => setActiveDocument(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
      >
        {document && (
          <>
            <header className="legal-document-header">
              <div>
                <img
                  className="legal-document-logo"
                  src="https://image2url.com/r2/default/images/1773576400522-25d9d22b-3e79-4a9a-adc2-eae0031fbfe1.png"
                  alt="Campus Ghana"
                />
                <span>Campus Ghana</span>
                <h2 id="legal-document-title">{document.label}</h2>
                <p>Last updated November 16, 2026</p>
              </div>
              <button
                className="legal-document-close"
                type="button"
                aria-label="Close legal information"
                onClick={closeDialog}
              >
                ×
              </button>
            </header>
            <nav className="legal-document-tabs" aria-label="Legal documents">
              {Object.entries(LEGAL_DOCUMENTS).map(([key, item]) => (
                <button
                  type="button"
                  key={key}
                  aria-pressed={activeDocument === key}
                  className={activeDocument === key ? "is-active" : ""}
                  onClick={() => setActiveDocument(key)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <article className="legal-document-body">
              {document.sections.map((section) => (
                <section key={section.title}>
                  <h3>{section.title}</h3>
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </section>
              ))}
            </article>
            <footer className="legal-document-footer">
              Questions? Contact <a href="mailto:mrwundengba@gmail.com">the Campus Ghana administrator</a>.
            </footer>
          </>
        )}
      </dialog>
    </div>
  );
}
