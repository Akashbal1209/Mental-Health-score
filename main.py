from pathlib import Path
from typing import Annotated, Literal

import joblib
import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, StringConstraints, model_validator

model = joblib.load(Path(__file__).parent / 'Mental_Health_Model.pkl')

# The 10 most frequent values of Country in the training data.
# 'Other' is already a value in the raw data, so this is 9 countries + 'Other'.
top_countries = ['Other', 'India', 'USA', 'Canada', 'Australia', 'UK', 'Germany', 'Mexico', 'Turkey', 'France']
country_lookup = {c.lower(): c for c in top_countries}   # 'india' -> 'India', 'usa' -> 'USA'

app = FastAPI(title='Mental Health Scorer API')

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class StudentData(BaseModel):
    age                     : int = Field(..., ge=18, le=24)
    gender                  : Literal['Male', 'Female']
    country                 : Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    academic_level          : Literal['Undergraduate', 'Graduate', 'High School']
    most_used_platform      : Literal['Facebook', 'LinkedIn', 'Instagram', 'Snapchat', 'Twitter', 'YouTube', 'TikTok', 'LINE', 'KakaoTalk', 'VKontakte', 'WhatsApp', 'WeChat']
    purpose_of_use          : Literal['Networking', 'Education', 'Entertainment', 'News']
    avg_daily_usage_hours   : float = Field(..., ge=0, le=24)
    daily_unlocks           : int   = Field(..., ge=0, le=1000)
    study_hours             : float = Field(..., ge=0, le=24)
    physical_activity_hours : float = Field(..., ge=0, le=24)
    sleep_hours_per_night   : float = Field(..., ge=0, le=24)
    stress_level            : Literal['Medium', 'Low', 'Very High', 'High']

    @model_validator(mode='after')
    def check_day_length(self):
        # Sleep, study and physical activity cannot add up to more than one day.
        # Screen time is left out because it can overlap with studying.
        total = self.sleep_hours_per_night + self.study_hours + self.physical_activity_hours
        if total > 24:
            raise ValueError(f'Sleep, study and activity hours add up to {total:g}, which is more than 24.')
        return self


class PredictionResponse(BaseModel):
    predicted_mental_health_score: float


@app.get('/')
def greet():
    return {'message': 'Welcome to Mental Health Scorer API'}


@app.post('/predict', response_model=PredictionResponse)
def predict(data: StudentData):

    country_group = country_lookup.get(data.country.lower(), 'Other')

    input_row = pd.DataFrame([{
        'Age'                     : data.age,
        'Gender'                  : data.gender,
        'Academic_Level'          : data.academic_level,
        'Most_Used_Platform'      : data.most_used_platform,
        'Purpose_Of_Use'          : data.purpose_of_use,
        'Avg_Daily_Usage_Hours'   : data.avg_daily_usage_hours,
        'Daily_Unlocks'           : data.daily_unlocks,
        'Study_Hours'             : data.study_hours,
        'Physical_Activity_Hours' : data.physical_activity_hours,
        'Sleep_Hours_Per_Night'   : data.sleep_hours_per_night,
        'Stress_Level'            : data.stress_level,
        'Grouped_country'         : country_group
    }])

    prediction = float(model.predict(input_row)[0])
    prediction = min(max(prediction, 0.0), 10.0)   # the score is always shown on a 0 to 10 scale
    return PredictionResponse(predicted_mental_health_score=round(prediction, 2))
