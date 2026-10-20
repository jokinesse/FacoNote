/**
 * Types TypeScript synchronisés avec les modèles Pydantic v2 du Backend FastAPI FacoNote.
 * Référence : DOCS_PASSATION.md & backend/app/models/
 */

export interface ShapedPieceModel {
  id: string;
  label: string;
  dev: number;
  length: number;
  quantity: number;
  bends?: number;
  material?: string;
  workshop_split_reason?: string | null;
  notes?: string | null;
  original_total_length_requested?: number | null;
}

export interface FastEncoderInputRequest {
  raw_input: string;
  material?: string;
  length_unit?: 'm' | 'mm';
  preset?: 'DEV_PIECE' | 'DEV_BOBINE';
}

export interface FastEncoderEntryResponse {
  raw_input: string;
  dev: number;
  unit_length_m: number;
  quantity: number;
  total_length_m: number;
  matched_bound: number;
  is_chute: boolean;
  is_auto_breakdown: boolean;
  surface_net_m2: number;
  weight_net_kg: number;
  material: string;
}

export interface AutoBreakdownRequest {
  total_meters: number;
  current_pieces?: ShapedPieceModel[];
  target_material?: string;
  forced_length?: number | null;
}

export interface BreakdownOption {
  length: number;
  quantity: number;
  total_produced: number;
  excess: number;
  is_exact: boolean;
  is_existing: boolean;
  is_closest: boolean;
  score: number;
  label: string;
}

export interface AutoPieceBreakdownResponse {
  length: number;
  quantity: number;
  total_produced: number;
  requested_meters: number;
  reason: string;
  source: string;
  alternatives: BreakdownOption[];
}

export interface StripModel {
  piece_id: string;
  label: string;
  dev: number;
  length: number;
  qty: number;
  material: string;
}

export interface SlitModel {
  mother_width: number;
  mother_length: number;
  material: string;
  strips: StripModel[];
  used_width: number;
  scrap_width: number;
  is_scrap_reusable: boolean;
  suggested_scrap_ref: string | null;
}

export interface ScrapProposalModel {
  proposal_id: string;
  piece_id: string;
  label: string;
  dev: number;
  length: number;
  rack_scrap_width: number;
  rack_scrap_ref: string;
  initial_loss_percent: number;
  reason: string;
}

export interface OptimizationRequest {
  client_name?: string;
  chantier_ref?: string;
  material?: string;
  pieces: ShapedPieceModel[];
  available_mother_widths?: number[];
  use_workshop_scraps?: boolean;
  accepted_proposal_ids?: string[] | null;
}

export interface OptimizationResponse {
  order_id: string;
  timestamp: number;
  material_efficiency_rate: number;
  total_net_surface_m2: number;
  total_gross_surface_m2: number;
  reusable_scrap_surface_m2: number;
  net_loss_surface_m2: number;
  net_weight_kg: number;
  gross_weight_kg: number;
  slits: SlitModel[];
  workshop_scrap_proposals: ScrapProposalModel[];
  applied_workshop_scraps: string[];
  summary_message: string;
}

export interface MobileSessionResponse {
  session_id: string;
  created_at: number;
  qr_url: string;
}

export interface MobileUploadRequest {
  session_id: string;
  image_base64: string;
  filename?: string;
  note?: string;
}

export interface MobileStatusResponse {
  session_id: string;
  status: 'waiting' | 'ready' | 'expired' | 'not_found';
  has_image: boolean;
  image_base64: string | null;
  filename: string | null;
  note: string | null;
  created_at: number;
}

export interface DocumentParseRequest {
  file_base64?: string | null;
  mime_type?: string;
  manual_text?: string | null;
  standard_length?: number;
}

export interface DocumentParseResponse {
  client: string;
  chantier: string;
  detected_finish: string;
  pieces: ShapedPieceModel[];
  raw_observations?: string | null;
  notes?: string | null;
}

export interface ImageProcessRequest {
  image_base64: string;
  rotation_deg?: number;
  contrast_boost?: number;
}

export interface ImageProcessResponse {
  data_uri: string;
  mime_type: string;
  width: number;
  height: number;
}

export interface ApiErrorDetail {
  loc?: Array<string | number>;
  msg?: string;
  type?: string;
}

export class ApiError extends Error {
  public status: number;
  public details?: ApiErrorDetail[] | string;
  public executionTimeMs?: number;

  constructor(message: string, status: number, details?: ApiErrorDetail[] | string, executionTimeMs?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.executionTimeMs = executionTimeMs;
  }
}
