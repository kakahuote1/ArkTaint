import type { CurrentnessCertificate } from "../oclfs";

export interface FactPredecessorRecord {
    toFactId: string;
    fromFactId: string;
    reason: string;
    currentnessCertificateIds?: string[];
    currentnessCertificates?: CurrentnessCertificate[];
}
