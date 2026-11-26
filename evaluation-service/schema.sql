create table if not exists sessions (
    id uuid primary key default gen_random_uuid(),
    interview_type text not null check (interview_type in ('technical', 'hr', 'behavioral')),
    status text not null default 'created' check (status in ('created', 'in_progress', 'completed')),
    created_at timestamptz not null default now(),
    completed_at timestamptz
);

create table if not exists questions (
    id uuid primary key default gen_random_uuid(),
    interview_type text not null check (interview_type in ('technical', 'hr', 'behavioral')),
    prompt text not null,
    "order" integer not null default 0,
    -- 'static' = shared pre-written bank; 'generated' = tailored to one user's
    -- session. The static-fallback seeding filters on source='static' so a
    -- session without CV/JD can never be seeded with another user's questions.
    source text not null default 'static' check (source in ('static', 'generated')),
    owner_user_id uuid,
    created_at timestamptz not null default now()
);

create table if not exists rubrics (
    id uuid primary key default gen_random_uuid(),
    interview_type text not null check (interview_type in ('technical', 'hr', 'behavioral')),
    dimension_key text not null,        
    dimension_label text not null,      
    description text not null,          
    "order" integer not null default 0,
    created_at timestamptz not null default now(),
    unique (interview_type, dimension_key)
);


create table if not exists evaluations (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references sessions(id) on delete cascade,
    question_id uuid references questions(id),
    transcript text,
    overall_score numeric,
    strengths text[],
    improvements text[],
    created_at timestamptz not null default now()
);

create index if not exists idx_evaluations_session_id on evaluations(session_id);

create table if not exists session_questions (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references sessions(id) on delete cascade,
    question_id uuid not null references questions(id),
    question_order integer not null,   
    answered boolean not null default false,
    created_at timestamptz not null default now(),
    unique (session_id, question_id)
);

create index if not exists idx_session_questions_session_id on session_questions(session_id);


insert into rubrics (interview_type, dimension_key, dimension_label, description, "order") values
('technical', 'problem_understanding', 'Problem Understanding', 'Did the candidate correctly interpret what the question was asking before answering?', 1),
('technical', 'approach_reasoning', 'Approach & Reasoning', 'Did the candidate verbally explain a logical method, algorithm, or strategy?', 2),
('technical', 'technical_correctness', 'Technical Correctness', 'Is the content of the spoken answer factually and conceptually accurate, with no errors?', 3),
('technical', 'edge_case_awareness', 'Edge Case Awareness', 'Did the candidate mention boundary conditions, failure modes, or exceptions verbally?', 4),
('technical', 'communication', 'Communication', 'Was the explanation clear, structured, and easy to follow when spoken aloud?', 5)
on conflict (interview_type, dimension_key) do nothing;

insert into rubrics (interview_type, dimension_key, dimension_label, description, "order") values
('behavioral', 'situation', 'Situation', 'Did the candidate clearly set the context/background for the story?', 1),
('behavioral', 'action', 'Action (Task)', 'Did the candidate describe specific actions they personally took, not just the team?', 2),
('behavioral', 'result', 'Result', 'Did the candidate share a measurable or concrete outcome of their actions?', 3),
('behavioral', 'communication', 'Communication', 'Was the story told in a structured, concise way that was easy to follow?', 4)
on conflict (interview_type, dimension_key) do nothing;


insert into rubrics (interview_type, dimension_key, dimension_label, description, "order") values
('hr', 'role_relevance', 'Relevance to Role/Company', 'Did the candidate connect their answer specifically to this role or company, rather than giving a generic answer?', 1),
('hr', 'authenticity', 'Authenticity', 'Does the answer sound genuine and personal rather than rehearsed or generic?', 2),
('hr', 'professionalism', 'Professionalism', 'Did the candidate avoid oversharing, negativity about past employers, or red-flag statements?', 3),
('hr', 'clarity', 'Clarity & Conciseness', 'Was the answer clear and reasonably concise, without rambling?', 4)
on conflict (interview_type, dimension_key) do nothing;


insert into questions (interview_type, prompt, "order") values

('technical', 'What is the difference between a stack and a queue? When would you use one over the other?', 1),
('technical', 'Explain how a hash table works, including how it handles collisions.', 2),
('technical', 'What is the difference between SQL and NoSQL databases? Give an example of when you would choose each.', 3),
('technical', 'Explain the concept of RESTful APIs. What makes an API RESTful?', 4),
('technical', 'What is the difference between synchronous and asynchronous programming? Why does it matter?', 5),

('behavioral', 'Tell me about a time you had to work under a tight deadline. How did you handle it?', 1),
('behavioral', 'Describe a situation where you disagreed with a teammate. How did you resolve it?', 2),
('behavioral', 'Tell me about a project you are most proud of. What was your specific contribution?', 3),
('behavioral', 'Describe a time when you had to learn a new technology or skill quickly. What was your approach?', 4),
('behavioral', 'Tell me about a time you made a mistake at work or in a project. How did you handle it?', 5),

('hr', 'Tell me about yourself and why you are interested in this role.', 1),
('hr', 'Where do you see yourself in five years?', 2),
('hr', 'Why are you leaving your current position (or why are you looking for an internship)?', 3),
('hr', 'What are your greatest strengths and one area you are actively working to improve?', 4),
('hr', 'Do you have any questions for us?', 5)

on conflict do nothing;